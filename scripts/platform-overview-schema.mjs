export async function migratePlatformOverview(c) {
  await c.query(
    `CREATE TABLE IF NOT EXISTS account_activity(user_id INT PRIMARY KEY,last_seen_at DATETIME NOT NULL,INDEX activity_seen(last_seen_at),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
  await c.query(
    `CREATE TABLE IF NOT EXISTS workspace_activity(store_id INT NOT NULL,user_id INT NOT NULL,last_seen_at DATETIME NOT NULL,PRIMARY KEY(store_id,user_id),INDEX activity_store_seen(store_id,last_seen_at),FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
}
