// The receipt ledger is authoritative. Keep the stored value only for legacy
// orders that predate receipts, so historic paid orders are not reset to unpaid.
export function orderPaymentStatusSQL(orderAlias = "o") {
  if (!/^[a-z_]+$/i.test(orderAlias)) throw Error("Invalid order alias");
  return `(SELECT CASE
    WHEN COUNT(*)=0 THEN ${orderAlias}.payment_status
    WHEN SUM(IF(payment_state.kind='collect',payment_state.amount,-payment_state.amount))>=${orderAlias}.total THEN 'paid'
    WHEN SUM(IF(payment_state.kind='collect',payment_state.amount,-payment_state.amount))=0 THEN 'refunded'
    WHEN (SELECT payment_latest.kind FROM order_payments payment_latest WHERE payment_latest.order_id=${orderAlias}.id AND payment_latest.store_id=${orderAlias}.store_id ORDER BY payment_latest.id DESC LIMIT 1)='refund' THEN 'partially_refunded'
    ELSE 'partially_paid' END
    FROM order_payments payment_state WHERE payment_state.order_id=${orderAlias}.id AND payment_state.store_id=${orderAlias}.store_id)`;
}
