"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { CalendarDays, Clock3, X } from "lucide-react";

type TemporalType = "date" | "month" | "time" | "datetime-local";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: TemporalType;
};

function displayValue(value: string, type: TemporalType) {
  if (!value) return "";
  if (type === "time") return value;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  if (!year || !month || (type !== "month" && !day)) return "";
  const result =
    type === "month" ? `${month}/${year}` : `${day}/${month}/${year}`;
  return type === "datetime-local" ? `${result} · ${time || ""}` : result;
}

/** Use the OS picker and native validation, but render a stable, compact value.
 * iOS's localized date text lives in a shadow tree and can ignore desktop CSS.
 */
export default function DateInput({
  type = "date",
  className = "",
  value,
  defaultValue,
  placeholder,
  onChange,
  onClick,
  onKeyDown,
  style,
  ...props
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ""));
  const displayed = displayValue(String(value ?? uncontrolled), type);
  const hint =
    placeholder ||
    (type === "month"
      ? "Chọn tháng"
      : type === "time"
        ? "Chọn giờ"
        : type === "datetime-local"
          ? "Chọn ngày, giờ"
          : "Chọn ngày");
  useLayoutEffect(() => {
    // The clear button must not become part of the input's accessible name.
    const name = Array.from(input.current?.labels || [])
      .map((original) => {
        const copy = original.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".date-control").forEach((node) => node.remove());
        return copy.textContent?.trim() || "";
      })
      .join(" ");
    setLabel(name);
  }, []);
  useEffect(() => {
    const field = input.current,
      form = field?.form;
    let frame = 0;
    const reset = () => {
      frame = requestAnimationFrame(() => setUncontrolled(field?.value || ""));
    };
    form?.addEventListener("reset", reset);
    return () => {
      form?.removeEventListener("reset", reset);
      cancelAnimationFrame(frame);
    };
  }, []);
  const Icon = type === "time" ? Clock3 : CalendarDays;
  return (
    <span
      className={"date-control " + className}
      style={style}
      data-empty={!displayed}
    >
      <input
        {...props}
        aria-label={props["aria-label"] || label || undefined}
        ref={input}
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={(event) => {
          setUncontrolled(event.target.value);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            ["Enter", " "].includes(event.key) &&
            !event.currentTarget.readOnly &&
            !event.currentTarget.disabled &&
            event.currentTarget.showPicker
          ) {
            try {
              event.currentTarget.showPicker();
              event.preventDefault();
            } catch {
              /* Native keyboard fallback */
            }
          }
        }}
        onClick={(event) => {
          onClick?.(event);
          if (
            !event.defaultPrevented &&
            !event.currentTarget.readOnly &&
            !event.currentTarget.disabled
          ) {
            // A real click supplies the transient activation required by showPicker.
            // Safari versions without this method continue with their native tap.
            try {
              event.currentTarget.showPicker?.();
            } catch {
              /* OS fallback */
            }
          }
        }}
      />
      <span className="date-control-value" aria-hidden="true">
        {displayed || hint}
      </span>
      {displayed && !props.required && !props.readOnly && !props.disabled ? (
        <button
          type="button"
          className="date-control-clear"
          aria-label={
            type === "month"
              ? "Xóa tháng đã chọn"
              : type === "time"
                ? "Xóa giờ đã chọn"
                : "Xóa ngày đã chọn"
          }
          onClick={(event) => {
            event.preventDefault();
            const field = input.current;
            if (!field || field.matches(":disabled")) return;
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )!.set!.call(field, "");
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.dispatchEvent(new Event("change", { bubbles: true }));
            setUncontrolled("");
            field.focus();
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        <Icon size={16} aria-hidden="true" />
      )}
    </span>
  );
}
