export const orderStates = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "shipping",
  "delivered",
  "cancelled",
] as const;
export function needsTransitionReason(from: string, to: string) {
  return (
    to === "cancelled" ||
    from === "cancelled" ||
    orderStates.indexOf(to as any) < orderStates.indexOf(from as any)
  );
}
export const paymentMethods: Record<string, string> = {
  cod: "Thanh toán khi nhận hoa (COD)",
  bank: "Chuyển khoản ngân hàng",
};
