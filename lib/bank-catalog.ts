import banks from "./vietqr-banks.json";

// Canonical BINs from https://api.vietqr.io/v2/banks (2026-10-20).
export { banks };
export function findBank(value: string) {
  const key = value.trim().toUpperCase();
  return banks.find((b) =>
    [b.bin, b.code, b.name].some((v) => v.toUpperCase() === key),
  );
}
