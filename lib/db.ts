import mysql from "mysql2/promise";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
const globalDB = globalThis as unknown as { fleurPool?: mysql.Pool };
export const pool =
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
    decimalNumbers: true,
    charset: "utf8mb4",
  });
if (process.env.NODE_ENV !== "production") globalDB.fleurPool = pool;
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
