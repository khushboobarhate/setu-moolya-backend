const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { once } = require("node:events");

test("credential mail uses the correct role login link and retries temporary SMTP failures", async (t) => {
  const recipients = [],
    messages = [];
  let recipientResponses = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost test SMTP\r\n");
    let buffer = "",
      inData = false,
      message = "";
    socket.on("data", (data) => {
      buffer += data;
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(message);
            socket.write("250 Accepted\r\n");
          } else message += `${line}\r\n`;
        } else if (/^EHLO/.test(line))
          socket.write("250-localhost\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^AUTH/.test(line)) socket.write("235 Authenticated\r\n");
        else if (/^MAIL FROM/.test(line)) socket.write("250 Sender OK\r\n");
        else if (/^RCPT TO/.test(line)) {
          recipients.push(line);
          const response = recipientResponses.length
            ? recipientResponses.shift()
            : "250 Recipient OK";
          socket.write(`${response}\r\n`);
        } else if (line === "DATA") {
          inData = true;
          socket.write("354 End with dot\r\n");
        } else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  process.env.EMAIL_HOST = "127.0.0.1";
  process.env.EMAIL_PORT = String(server.address().port);
  process.env.EMAIL_USER = "sender@example.com";
  process.env.EMAIL_PASS = "test-password";
  const {
    sendEmail,
    buildApprovalEmail,
    buildPasswordResetEmail,
  } = require("../src/config/email");
  const emailInput = {
    fullName: '<script>alert("x")</script>',
    loginId: "farmer@example.com",
    password: "Random-password1!",
    expiresAt: "2026-10-28T00:00:00Z",
  };

  for (const role of ["farmer", "buyer"]) {
    const content = buildApprovalEmail({
      ...emailInput,
      role,
      loginUrl: "https://example.com/login?role=admin&source=approval",
    });
    assert.match(
      content.text,
      new RegExp(`https://example\\.com/login\\?role=${role}&source=approval`),
    );
    assert.match(
      content.html,
      new RegExp(
        `https://example\\.com/login\\?role=${role}&amp;source=approval`,
      ),
    );
  }
  assert.throws(() =>
    buildApprovalEmail({
      ...emailInput,
      role: "admin",
      loginUrl: "https://example.com/login",
    }),
  );
  assert.throws(() =>
    buildApprovalEmail({
      ...emailInput,
      role: "farmer",
      loginUrl: "javascript:alert(1)",
    }),
  );
  const safeContent = buildApprovalEmail({
    ...emailInput,
    role: "farmer",
    loginUrl: "https://example.com/login",
  });
  assert.doesNotMatch(safeContent.html, /<script>/);
  assert.match(safeContent.html, /&lt;script&gt;/);

  recipientResponses = [
    "451 4.3.0 Temporary mailbox failure",
    "250 Recipient OK",
  ];
  const delivered = await sendEmail({
    to: "farmer@example.com",
    ...safeContent,
  });
  assert.equal(delivered.success, true);
  assert.equal(
    recipients.length,
    2,
    "a temporary 4xx rejection should be retried once",
  );
  assert.match(messages[0], /Random-password1!/);

  recipientResponses = ["550 5.1.1 Mailbox unavailable"];
  const beforePermanentFailure = recipients.length;
  const failed = await sendEmail({
    to: "farmer@example.com",
    ...buildPasswordResetEmail({
      fullName: "Farmer",
      resetUrl: "https://example.com/reset#token_hash=secret",
    }),
  });
  assert.equal(failed.success, false);
  assert.equal(
    recipients.length - beforePermanentFailure,
    1,
    "a permanent 5xx recipient rejection should not be retried",
  );
});
