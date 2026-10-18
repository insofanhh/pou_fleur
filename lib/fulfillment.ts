import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "./auth";
import { distanceKm, type StoreRecord } from "./stores";

// Caller locks the store row before invoking this inside an order transaction.
export async function validateFulfillment(
  c: PoolConnection,
  store: StoreRecord,
  body: {
    deliveryDate: string;
    deliverySlot: string;
    deliveryLat?: number;
    deliveryLng?: number;
  },
  excludeOrder?: number,
  requireCoordinates = false,
) {
  const { settings } = store;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(new Date());
  const latest = formatter.format(
    new Date(Date.now() + settings.advance_days * 86400000),
  );
  const date = Date.parse(body.deliveryDate + "T12:00:00Z");
  const start = Date.parse(
    body.deliveryDate + "T" + body.deliverySlot.slice(0, 5) + ":00+07:00",
  );
  if (
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== body.deliveryDate ||
    body.deliveryDate < today ||
    body.deliveryDate > latest
  )
    throw new HttpError(
      400,
      "Ngày giao không hợp lệ hoặc vượt khoảng đặt trước.",
    );
  if (
    !Number.isFinite(start) ||
    !settings.slots.includes(body.deliverySlot) ||
    settings.closed_dates.includes(body.deliveryDate) ||
    start < Date.now() + settings.lead_minutes * 60000
  )
    throw new HttpError(
      409,
      "Khung giờ không khả dụng hoặc chưa đủ thời gian chuẩn bị.",
    );
  const [rows]: any = await c.execute(
    "SELECT COUNT(*) n FROM orders WHERE delivery_date=? AND delivery_slot=? AND status<>'cancelled' AND id<>?",
    [body.deliveryDate, body.deliverySlot, excludeOrder || 0],
  );
  if (rows[0].n >= settings.capacity)
    throw new HttpError(409, "Khung giờ đã đủ đơn. Vui lòng chọn khung khác.");
  if ((body.deliveryLat === undefined) !== (body.deliveryLng === undefined))
    throw new HttpError(400, "Cần nhập đủ vĩ độ và kinh độ.");
  if (
    requireCoordinates &&
    store.lat !== null &&
    store.lng !== null &&
    (body.deliveryLat === undefined || body.deliveryLng === undefined)
  )
    throw new HttpError(400, "Cần chọn tọa độ địa chỉ để kiểm tra vùng giao.");
  if (
    body.deliveryLat !== undefined &&
    body.deliveryLng !== undefined &&
    store.lat !== null &&
    store.lng !== null &&
    distanceKm(store.lat, store.lng, body.deliveryLat, body.deliveryLng) >
      store.radius_km
  )
    throw new HttpError(409, "Địa chỉ nhận ngoài bán kính giao của cửa hàng.");
}
