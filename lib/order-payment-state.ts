// The receipt ledger is authoritative. Keep the stored value only for legacy
// orders that predate receipts, so historic paid orders are not reset to unpaid.
export function orderPaymentStatusSQL(orderAlias = "o") {
  if (!/^[a-z_]+$/i.test(orderAlias)) throw Error("Invalid order alias");
  const scope = `payment_state.order_id=${orderAlias}.id AND payment_state.store_id=${orderAlias}.store_id`;
  const balance = `(SELECT SUM(IF(payment_state.kind IN ('collect','correction'),payment_state.amount,-payment_state.amount)) FROM order_payments payment_state WHERE ${scope})`;
  const latest = `(SELECT payment_latest.kind FROM order_payments payment_latest WHERE payment_latest.order_id=${orderAlias}.id AND payment_latest.store_id=${orderAlias}.store_id ORDER BY payment_latest.id DESC LIMIT 1)`;
  // Keep CASE at the order level and each correlated query one level below it.
  // TiDB cannot resolve the outer order in the old aggregate CASE subquery.
  return `(CASE
    WHEN NOT EXISTS(SELECT 1 FROM order_payments payment_state WHERE ${scope}) THEN ${orderAlias}.payment_status
    WHEN ${balance}>=${orderAlias}.total THEN 'paid'
    WHEN ${balance}=0 AND ${latest}='refund' THEN 'refunded'
    WHEN ${balance}=0 THEN 'unpaid'
    WHEN ${latest}='refund' THEN 'partially_refunded'
    ELSE 'partially_paid' END)`;
}
