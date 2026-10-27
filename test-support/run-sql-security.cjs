// Uses a disposable PostgreSQL cluster, never DATABASE_URL or the live project.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "setu-sql-audit-"));
const bin =
  process.env.PG_BIN ||
  execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
let started = false;
try {
  execFileSync(
    path.join(bin, "initdb"),
    [
      "-D",
      directory,
      "-A",
      "trust",
      "-U",
      "setu_audit",
      "--no-locale",
      "--encoding=UTF8",
    ],
    { stdio: "pipe" },
  );
  execFileSync(
    path.join(bin, "pg_ctl"),
    [
      "-D",
      directory,
      "-o",
      `-k ${directory} -h '' -p 56541`,
      "-l",
      path.join(directory, "server.log"),
      "start",
    ],
    { stdio: "pipe" },
  );
  started = true;
  const apply = (file) =>
    execFileSync(
      path.join(bin, "psql"),
      [
        "-h",
        directory,
        "-p",
        "56541",
        "-U",
        "setu_audit",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        path.resolve(__dirname, "..", file),
      ],
      { stdio: "pipe" },
    );
  apply("test-support/supabase-fixture.sql");
  apply("supabase_schema.sql");
  apply("test-support/registration-security.sql");
  console.log(
    "Fresh schema: RLS, privilege escalation, leases and approval checks passed.",
  );
  apply("supabase_migration_v2.sql");
  apply("supabase_migration_v4.sql");
  apply("supabase_migration_v4.sql");
  apply("test-support/registration-security.sql");
  console.log(
    "v2 → v4 upgrade and repeated migration: security checks passed.",
  );
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  if (started)
    execFileSync(
      path.join(bin, "pg_ctl"),
      ["-D", directory, "-m", "immediate", "stop"],
      { stdio: "pipe" },
    );
  fs.rmSync(directory, { recursive: true, force: true });
}
