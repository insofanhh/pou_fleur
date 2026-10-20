import { orderLabels } from "./display-labels";

export function isPickup(order: { fulfillment_method?: string | null }) {
  return order.fulfillment_method === "pickup";
}

export function orderStateLabel(
  order: { fulfillment_method?: string | null; status?: string },
  status = order.status || "",
) {
  if (isPickup(order)) {
    if (status === "delivered") return "Đã nhận tại cửa hàng";
    if (status === "ready") return "Sẵn sàng nhận";
    if (status === "cod_collected") return "Đã thu tại quầy";
  }
  return orderLabels[status] || status;
}

export function orderMethodLabel(order: {
  fulfillment_method?: string | null;
  payment_method?: string;
}) {
  return order.payment_method === "bank"
    ? "Chuyển khoản ngân hàng"
    : isPickup(order)
      ? "Thanh toán tại quầy"
      : "Thanh toán khi nhận hoa (COD)";
}

export function pickupLocation(order: {
  pickup_location_snapshot?: unknown;
  address?: string;
  store_name?: string;
}) {
  try {
    const value =
      typeof order.pickup_location_snapshot === "string"
        ? JSON.parse(order.pickup_location_snapshot)
        : order.pickup_location_snapshot;
    if (value && typeof value === "object")
      return value as { name?: string; address?: string; phone?: string };
  } catch {}
  return { name: order.store_name || "", address: order.address || "" };
}
