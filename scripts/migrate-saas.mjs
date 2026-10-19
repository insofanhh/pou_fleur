import mysql from "mysql2/promise";
import { migrateSaaS } from "./saas-schema.mjs";
if (
  !["localhost", "127.0.0.1"].includes(process.env.MYSQL_HOST || "127.0.0.1") &&
  !process.argv.includes("--production-backup-verified")
)
  throw Error(
    "Remote migration requires --production-backup-verified after a restore drill",
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
  await migrateSaaS(c);
  console.log("SaaS migration complete");
} finally {
  await c.end();
}
