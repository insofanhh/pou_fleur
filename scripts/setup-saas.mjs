import "./setup-db.mjs";
import mysql from "mysql2/promise";
import { migrateSaaS } from "./saas-schema.mjs";
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
  console.log(
    "SaaS schema ready. Platform access is granted separately with scripts/platform-admin.mjs.",
  );
} finally {
  await c.end();
}
