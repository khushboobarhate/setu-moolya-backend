const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { once } = require("node:events");

test("SMTP sends a single credential recipient, escapes HTML and reports rejected delivery", async (t) => {
    let rejected = false;
    const recipients = [], messages = [];
    const server = net.createServer((socket) => {
        socket.setEncoding("utf8");
        socket.write("220 localhost test SMTP\r\n");
        let buffer = "", inData = false, message = "";
        socket.on("data", (data) => {
            buffer += data;
            while (buffer.includes("\r\n")) {
                const index = buffer.indexOf("\r\n");
                const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
                if (inData) {
                    if (line === ".") { inData = false; messages.push(message); socket.write("250 Accepted\r\n"); }
                    else message += line + "\r\n";
                } else if (/^EHLO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN LOGIN\r\n");
                else if (/^AUTH/.test(line)) socket.write("235 Authenticated\r\n");
                else if (/^MAIL FROM/.test(line)) socket.write("250 Sender OK\r\n");
                else if (/^RCPT TO/.test(line)) { recipients.push(line); socket.write(rejected ? "550 Mailbox unavailable\r\n" : "250 Recipient OK\r\n"); }
                else if (line === "DATA") { inData = true; socket.write("354 End with dot\r\n"); }
                else if (line === "QUIT") { socket.end("221 Bye\r\n"); }
                else socket.write("250 OK\r\n");
            }
        });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));
    process.env.EMAIL_HOST = "127.0.0.1"; process.env.EMAIL_PORT = String(server.address().port);
    process.env.EMAIL_USER = "sender@example.com"; process.env.EMAIL_PASS = "test-password";
    const { sendEmail, buildApprovalEmail, buildPasswordResetEmail } = require("../src/config/email");
    const content = buildApprovalEmail({ fullName: '<script>alert("x")</script>', role: "farmer", loginId: "farmer@example.com", password: "Random-password1!", loginUrl: "https://example.com/login", expiresAt: "2026-10-28T00:00:00Z" });
    assert.doesNotMatch(content.html, /<script>/); assert.match(content.html, /&lt;script&gt;/);
    const sent = await sendEmail({ to: "farmer@example.com", ...content });
    assert.equal(sent.success, true); assert.deepEqual(recipients, ["RCPT TO:<farmer@example.com>"]);
    assert.match(messages[0], /Random-password1!/);
    rejected = true;
    const failed = await sendEmail({ to: "farmer@example.com", ...buildPasswordResetEmail({ fullName: "Farmer", resetUrl: "https://example.com/reset#token_hash=secret" }) });
    assert.equal(failed.success, false);
});
