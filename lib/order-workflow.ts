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

export const manualSalesChannels: Record<string, string> = {
  phone: "Điện thoại",
  zalo: "Zalo",
  social: "Facebook / Instagram",
  in_person: "Tại cửa hàng",
  other: "Khác",
};

export function orderChannel(order: {
  creation_source?: string | null;
  sales_channel?: string | null;
}) {
  if (order.creation_source !== "manual")
    return { key: "website", label: "Website" };
  const key = order.sales_channel || "";
  // Older manual orders may not have a channel; do not invent one for them.
  return Object.hasOwn(manualSalesChannels, key)
    ? { key, label: manualSalesChannels[key] }
    : { key: "manual", label: "Thủ công" };
}
