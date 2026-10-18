"use client";
import { useEffect, useId, useState } from "react";
import { api } from "./context";

export type DeliveryLocation = { lat: number; lng: number };
export default function DeliveryAddress({
  value,
  onChange,
  location,
  onLocation,
  enabled,
  label = "Địa chỉ nhận hoa",
  className = "span-2",
  selectionHint = "Đã chọn vị trí giao hoa. Kiểm tra số nhà và bổ sung hướng dẫn giao trong phần ghi chú.",
}: {
  value: string;
  onChange: (value: string) => void;
  location: DeliveryLocation | null;
  onLocation: (point: DeliveryLocation | null) => void;
  enabled: boolean;
  label?: string;
  className?: string;
  selectionHint?: string;
}) {
  const inputId = useId();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setSuggestions([]);
    if (!focused || !enabled || location || value.trim().length < 3) return;
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
  }, [value, location, enabled, focused]);
  return (
    <div
      className={`field delivery-address ${className}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onFocus={() => setFocused(true)}
    >
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name="address"
        required
        minLength={10}
        maxLength={500}
        autoComplete={enabled ? "off" : "street-address"}
        placeholder="Số nhà, đường, phường, tỉnh/thành phố"
        value={value}
        readOnly={busy}
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={`${inputId}-suggestions`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setFocused(false);
            setSuggestions([]);
          }
        }}
        onChange={(e) => {
          onChange(e.target.value);
          onLocation(null);
          setError("");
        }}
      />
      {focused && !!suggestions.length && (
        <div
          id={`${inputId}-suggestions`}
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
      {location && <small>{selectionHint}</small>}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
