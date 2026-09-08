import mysql from "mysql2/promise";
import { setupEmail } from "./email-schema.mjs";
for (const key of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"])
  if (!process.env[key]) throw Error("Missing " + key);
const db = process.env.MYSQL_DATABASE;
if (
  !/^[a-zA-Z0-9_]+$/.test(db) ||
  [
    "sys",
    "mysql",
    "information_schema",
    "performance_schema",
    "metrics_schema",
  ].includes(db.toLowerCase())
)
  throw Error("Use an application database.");
if (
  process.argv.includes("--tidb") &&
  (process.env.MYSQL_SSL !== "true" ||
    !process.env.MYSQL_PASSWORD ||
    ["localhost", "127.0.0.1", "::1"].includes(process.env.MYSQL_HOST))
)
  throw Error("TiDB requires cloud credentials and MYSQL_SSL=true");
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: db,
  ssl:
    process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
});
try {
  await setupEmail(c);
  console.log(
    "Email schema ready. Existing templates preserved. No email sent.",
  );
} finally {
  await c.end();
}
