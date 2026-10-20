export function isPaidCOD(order: any) {
  return order.payment_method === "cod" && order.payment_status === "paid";
}

export function codOutstanding(order: any) {
  if (order.payment_method !== "cod" || order.status === "cancelled") return 0;
  // Old paid badges without receipts must be reconciled before collecting again.
  if (order.payment_status === "paid") return 0;
  return Math.max(0, Number(order.total || 0) - Number(order.collected || 0));
}
export function codPayerLabel(order: any) {
  if (order.cod_payer === "recipient") return "Người nhận hoa trả tiền";
  if (order.cod_payer === "buyer" || order.delivery_mode === "self")
    return "Người đặt hoa trả tiền";
  return "Cần xác nhận người trả tiền";
}
