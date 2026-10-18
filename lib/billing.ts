import { query, mutate, pool } from "./db";
import { withSystem } from "./tenant";
// Invoked by the authenticated worker. No money is collected automatically.
export async function advanceBilling() {
  return withSystem(async () => {
    await mutate(
      "UPDATE subscriptions SET status='cancelled',version=version+1 WHERE cancel_at_period_end=1 AND period_end<CURDATE() AND status NOT IN ('cancelled','free')",
    );
    await mutate(
      "UPDATE subscriptions s SET status='past_due',version=version+1 WHERE status='active' AND EXISTS(SELECT 1 FROM invoices i WHERE i.store_id=s.store_id AND i.status='open' AND i.due_date<CURDATE())",
    );
    await mutate(
      "UPDATE subscriptions s SET status='restricted',version=version+1 WHERE status='past_due' AND EXISTS(SELECT 1 FROM invoices i WHERE i.store_id=s.store_id AND i.status='open' AND i.due_date<DATE_SUB(CURDATE(),INTERVAL 7 DAY))",
    );
    return { ok: true };
  });
}
