// Add the free entry tier without enrolling or changing any existing store.
export async function migrateExperiencePlan(c) {
  await c.beginTransaction();
  try {
    await c.query("SELECT id FROM plans WHERE id=1 FOR UPDATE");
    const [done] = await c.query("SELECT version FROM schema_migrations WHERE version='experience-plan-v1'");
    if (done.length) { await c.commit(); return { skipped: true }; }
    const [existing] = await c.query("SELECT id FROM plans WHERE id=4 FOR UPDATE");
    if (existing.length) throw Error("Plan ID 4 is occupied; review catalog before experience-plan migration");
    // Modest editable defaults; trial days belong to paid offers, never Free.
    const limits = { products: 10, staff: 1, storage_mb: 100, email_sends: 50, ai_messages: 10 };
    await c.execute("INSERT INTO plans(id,name,monthly_price,limits,active,trial_days) VALUES(4,'Trải nghiệm',0,?,1,0)", [JSON.stringify(limits)]);
    await c.execute("INSERT INTO plan_versions(plan_id,name,monthly_price,limits,trial_days,effective_at) VALUES(4,'Trải nghiệm',0,?,0,UTC_TIMESTAMP())", [JSON.stringify(limits)]);
    await c.query("INSERT INTO schema_migrations(version) VALUES('experience-plan-v1')");
    await c.commit(); return { skipped: false };
  } catch (e) { await c.rollback(); throw e; }
}
