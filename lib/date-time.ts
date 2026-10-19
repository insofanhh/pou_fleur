import { APP_TIME_ZONE, APP_UTC_OFFSET } from "./regional";

type DateValue = string | number | Date;
type SourceZone = "hanoi" | "utc";

// SQL TIMESTAMP strings are returned in the Hanoi DB session zone. Explicit
// billing/QR/ledger DATETIME instants remain UTC and must opt in with "utc".
export function parseDateTime(
  value: DateValue,
  source: SourceZone = "hanoi",
): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") return new Date(value);
  const input = value.trim().replace(" ", "T");
  if (!input) return new Date(NaN);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? input + "T00:00:00"
    : input;
  return new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
      ? normalized
      : normalized + (source === "utc" ? "Z" : APP_UTC_OFFSET),
  );
}

export function hanoiDateKey(
  value: DateValue = new Date(),
  source: SourceZone = "hanoi",
) {
  const date = parseDateTime(value, source);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatDateTime(
  value?: DateValue | null,
  source: SourceZone = "hanoi",
) {
  if (value === null || value === undefined || value === "") return "—";
  const date = parseDateTime(value, source);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

// Date-only business values (delivery, birthday, due day) must never shift days.
export function formatDate(
  value?: DateValue | null,
  source: SourceZone = "hanoi",
) {
  if (value === null || value === undefined || value === "") return "—";
  const date = parseDateTime(value, source);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function hanoiDateTimeInput(
  value: DateValue,
  source: SourceZone = "utc",
) {
  const date = parseDateTime(value, source);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function hanoiInputToISO(value: string) {
  return parseDateTime(value).toISOString();
}
