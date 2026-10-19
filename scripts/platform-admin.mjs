import mysql from "mysql2/promise";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const email = process.argv.find((a) => a.startsWith("--email="))?.slice(8);
if (!email || !email.includes("@"))
  throw Error(
    "Usage: node --env-file=.env.local scripts/platform-admin.mjs --email=owner@example.com [--revoke]",
  );
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl:
    process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  let [[u]] = await c.execute(
    "SELECT id FROM users WHERE email=? AND active=1",
    [email],
  );
  let credentials;
  if (
    !u &&
    process.argv.includes("--create") &&
    !process.argv.includes("--revoke")
  ) {
    const password = randomBytes(24).toString("base64url"),
      salt = randomBytes(16).toString("hex");
    const [r] = await c.execute(
      "INSERT INTO users(name,email,password_hash,phone,address) VALUES('Fleur Platform Admin',?,?,?,'')",
      [email, salt + ":" + scryptSync(password, salt, 64).toString("hex"), ""],
    );
    u = { id: r.insertId };
    credentials = `URL: ${process.env.APP_ORIGIN || "http://127.0.0.1:3000"}/login\nEmail: ${email}\nPassword: ${password}\n`;
  }
  if (!u)
    throw Error(
      "Register this account first, or use --create to create it with a generated password.",
    );
  if (process.argv.includes("--revoke"))
    await c.execute("DELETE FROM platform_memberships WHERE user_id=?", [u.id]);
  else
    await c.execute(
      "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
      [u.id],
    );
  console.log("Platform membership updated for the specified account.");
  if (credentials) {
    await mkdir(".local", { recursive: true });
    const file = resolve(".local/platform-admin-credentials.txt");
    await writeFile(file, credentials, { mode: 0o600 });
    console.log("Generated credentials saved privately to " + file);
  }
} finally {
  await c.end();
}
