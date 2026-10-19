import { scopedSQL } from "./tenant";
import { APP_UTC_OFFSET } from "./regional";
import mysql from "mysql2/promise";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
const globalDB = globalThis as unknown as { fleurPool?: mysql.Pool };
const rawPool =
  globalDB.fleurPool ??
  mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "fleur_store",
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 5000,
    enableKeepAlive: true,
    ssl:
      process.env.MYSQL_SSL === "true"
        ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
        : undefined,
    dateStrings: true,
    timezone: APP_UTC_OFFSET,
    decimalNumbers: true,
    charset: "utf8mb4",
  });
if (process.env.NODE_ENV !== "production") globalDB.fleurPool = rawPool;
const initialized = new WeakSet<object>();
async function regionalConnection() {
  const c = await rawPool.getConnection();
  try {
    if (!initialized.has(c.connection)) {
      // SQL calendar dates and TIMESTAMP reads use Hanoi on MySQL and TiDB.
      // Explicit UTC DATETIME billing/QR instants keep using UTC_TIMESTAMP.
      await c.query("SET time_zone = ?", [APP_UTC_OFFSET]);
      initialized.add(c.connection);
    }
    return c;
  } catch (error) {
    c.destroy();
    throw error;
  }
}
async function runSQL(
  method: "execute" | "query",
  sql: string,
  values?: any[],
) {
  const c = await regionalConnection();
  try {
    return await (method === "execute"
      ? c.execute(scopedSQL(sql), values)
      : c.query(scopedSQL(sql), values));
  } finally {
    c.release();
  }
}
function scopedConnection(c: mysql.PoolConnection) {
  return new Proxy(c, {
    get(target, key) {
      if (key === "execute" || key === "query")
        return (sql: string, values?: any[]) =>
          (target[key] as any)(scopedSQL(sql), values);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export const pool = {
  end: () => rawPool.end(),
  execute: (sql: string, values?: any[]) => runSQL("execute", sql, values),
  query: (sql: string, values?: any[]) => runSQL("query", sql, values),
  getConnection: async () => scopedConnection(await regionalConnection()),
};
export async function query<T = RowDataPacket[]>(
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const [rows] = await pool.execute(sql, values as any[]);
  return rows as T;
}
export async function mutate(sql: string, values: unknown[] = []) {
  return query<ResultSetHeader>(sql, values);
}
export async function catalog() {
  const [products, categories, posts, events] = await Promise.all([
    query(
      "SELECT p.*,c.name category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.id",
    ),
    query("SELECT * FROM categories ORDER BY id"),
    query("SELECT * FROM posts WHERE published=1 ORDER BY created_at DESC"),
    query("SELECT * FROM events WHERE active=1 ORDER BY starts_at"),
  ]);
  return {
    products,
    categories,
    posts,
    events,
  } as unknown as import("./types").Catalog;
}
