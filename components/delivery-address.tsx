"use client";
import { useEffect, useState } from "react";
import { api } from "./context";

export type DeliveryLocation = { lat: number; lng: number };
export default function DeliveryAddress({
  value,
  onChange,
  location,
  onLocation,
  enabled,
}: {
  value: string;
  onChange: (value: string) => void;
  location: DeliveryLocation | null;
  onLocation: (point: DeliveryLocation | null) => void;
  enabled: boolean;
}) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSuggestions([]);
    if (!enabled || location || value.trim().length < 3) return;
    let active = true;
    const timer = setTimeout(() => {
      api(
        "goong/search?input=" + encodeURIComponent(value) + "&session=checkout",
      )
        .then((d) => {
          if (active) {
            setSuggestions(d.predictions || []);
            setError("");
          }
        })
        .catch(() => {
          if (active)
            setError(
              "Chưa tìm được vị trí. Bạn vẫn có thể nhập đầy đủ địa chỉ để cửa hàng xác nhận.",
            );
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, location, enabled]);
  return (
    <div className="field span-2 delivery-address">
      <label htmlFor="delivery-address-input">Địa chỉ nhận hoa</label>
      <input
        id="delivery-address-input"
        name="address"
        required
        minLength={10}
        maxLength={500}
        autoComplete="street-address"
        placeholder="Số nhà, đường, phường, tỉnh/thành phố"
        value={value}
        aria-expanded={suggestions.length > 0}
        aria-controls="delivery-address-suggestions"
        onChange={(e) => {
          onChange(e.target.value);
          onLocation(null);
          setError("");
        }}
      />
      {!!suggestions.length && (
        <div
          id="delivery-address-suggestions"
          className="delivery-address-options"
          aria-label="Gợi ý địa chỉ"
        >
          {suggestions.map((p) => (
            <button
              type="button"
              key={p.place_id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const d = await api(
                    "goong/detail?place_id=" +
                      encodeURIComponent(p.place_id) +
                      "&session=checkout",
                  );
                  const point = d.result?.geometry?.location;
                  if (
                    !Number.isFinite(point?.lat) ||
                    !Number.isFinite(point?.lng)
                  )
                    throw Error();
                  onChange(p.description);
                  onLocation(point);
                  setSuggestions([]);
                  setError("");
                } catch {
                  setError(
                    "Chưa lấy được vị trí địa chỉ. Vui lòng thử chọn lại.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {p.description}
            </button>
          ))}
        </div>
      )}
      {location && (
        <small>
          Đã chọn vị trí giao hoa. Kiểm tra số nhà và bổ sung hướng dẫn giao
          trong phần ghi chú.
        </small>
      )}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
