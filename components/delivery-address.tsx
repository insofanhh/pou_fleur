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
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    setSuggestions([]);
    setActiveIndex(-1);
    setSearched(false);
    setSearching(false);
    if (!focused || !enabled || location || value.trim().length < 3) return;
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api(
        "goong/search?input=" + encodeURIComponent(value) + "&session=checkout",
      )
        .then((d) => {
          if (active) {
            setSuggestions(d.predictions || []);
            setError("");
            setSearched(true);
          }
        })
        .catch(() => {
          if (active)
            setError(
              "Chưa tìm được vị trí. Bạn vẫn có thể nhập đầy đủ địa chỉ để cửa hàng xác nhận.",
            );
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, location, enabled, focused]);
  async function selectAddress(p: any) {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api(
        "goong/detail?place_id=" +
          encodeURIComponent(p.place_id) +
          "&session=checkout",
      );
      const point = d.result?.geometry?.location;
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng))
        throw Error();
      onChange(p.description);
      onLocation(point);
      setSuggestions([]);
      setActiveIndex(-1);
      setError("");
    } catch {
      setError("Chưa lấy được vị trí địa chỉ. Vui lòng thử chọn lại.");
    } finally {
      setBusy(false);
    }
  }
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
        role={enabled ? "combobox" : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={
          focused && suggestions.length ? `${inputId}-suggestions` : undefined
        }
        aria-activedescendant={
          focused && activeIndex >= 0
            ? `${inputId}-option-${activeIndex}`
            : undefined
        }
        aria-describedby={`${inputId}-hint`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setFocused(false);
            setSuggestions([]);
          }
          if (
            focused &&
            suggestions.length &&
            ["ArrowDown", "ArrowUp"].includes(e.key)
          ) {
            e.preventDefault();
            setActiveIndex((i) =>
              i < 0
                ? e.key === "ArrowDown"
                  ? 0
                  : suggestions.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                  suggestions.length,
            );
          }
          if (
            e.key === "Enter" &&
            focused &&
            activeIndex >= 0 &&
            suggestions[activeIndex]
          ) {
            e.preventDefault();
            void selectAddress(suggestions[activeIndex]);
          }
        }}
        onChange={(e) => {
          setFocused(true);
          onChange(e.target.value);
          onLocation(null);
          setError("");
        }}
      />
      {focused && !!suggestions.length && (
        <div
          id={`${inputId}-suggestions`}
          className="delivery-address-options"
          role="listbox"
          aria-label="Gợi ý địa chỉ"
        >
          {suggestions.map((p, i) => (
            <button
              type="button"
              key={p.place_id}
              id={`${inputId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              disabled={busy}
              // Keep the input focused until click runs; Safari may blur it
              // without a relatedTarget and otherwise unmount this button.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void selectAddress(p)}
            >
              {p.description}
            </button>
          ))}
        </div>
      )}
      <small id={`${inputId}-hint`}>
        {location
          ? selectionHint
          : enabled
            ? "Nhập từ 3 ký tự và chọn địa chỉ trong gợi ý Goong. Có thể bổ sung số nhà, hướng dẫn giao ở phần ghi chú."
            : "Nhập đầy đủ số nhà, đường, phường và tỉnh/thành phố."}
      </small>
      {focused && searching && <small role="status">Đang tìm địa chỉ…</small>}
      {focused &&
        searched &&
        !searching &&
        !suggestions.length &&
        !location &&
        !error && (
          <small role="status">
            Chưa có địa chỉ phù hợp. Thử thêm tên đường, quận hoặc thành phố;
            bạn vẫn có thể nhập địa chỉ thủ công.
          </small>
        )}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
