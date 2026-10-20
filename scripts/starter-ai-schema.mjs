// One-time entitlement expansion: Starter used to be forcibly saved as zero.
// Do not rerun the conversion after an admin has explicitly chosen zero in the
// new UI. Historical prices/trial dates/other quotas stay untouched.
export async function migrateStarterAI(c) {
  await c.beginTransaction();
  try {
    // Serialize concurrent migration runs on the same catalog row.
    const [plans] = await c.query("SELECT id,limits FROM plans WHERE id=1 FOR UPDATE");
    const [done] = await c.query("SELECT version FROM schema_migrations WHERE version='starter-ai-allowance-v1'");
    if (done.length) { await c.commit(); return { skipped: true, updated: 0 }; }
    if (!plans.length) throw Error("Starter catalog must exist before AI migration");
    const [versions] = await c.query("SELECT id,limits FROM plan_versions WHERE plan_id=1 FOR UPDATE");
    let updated = 0;
    for (const [table, rows] of [["plans", plans], ["plan_versions", versions]]) {
      for (const row of rows) {
        const limits = typeof row.limits === "string" ? JSON.parse(row.limits) : { ...(row.limits || {}) };
        if (limits.ai_messages == null || Number(limits.ai_messages) === 0) {
          limits.ai_messages = 50;
          await c.execute(`UPDATE ${table} SET limits=? WHERE id=?`, [JSON.stringify(limits), row.id]);
          updated++;
        }
      }
    }
    await c.query("INSERT INTO schema_migrations(version) VALUES('starter-ai-allowance-v1')");
    await c.commit();
    return { skipped: false, updated };
  } catch (error) { await c.rollback(); throw error; }
}
