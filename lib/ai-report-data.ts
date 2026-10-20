import { loadStoreAnalytics, type AnalyticsReader } from "./store-analytics";
import { hanoiDateKey, parseDateTime } from "./date-time";
import type { AIAnalyticsReport } from "./ai-report";

// The primary period is always authoritative. Prior-period values are optional,
// never added to current totals or sent to the model for a simple period report.
export async function loadAIReport(from: string, to: string, storeId: number, read: AnalyticsReader, comparePrevious = false): Promise<AIAnalyticsReport & { definition: string }> {
  const { period, summary, previous, products, sources, deliveries } = await loadStoreAnalytics(from, to, storeId, read, { comparePrevious });
  const { previousFrom, previousTo, ...currentPeriod } = period;
  return {
    period: comparePrevious ? period : currentPeriod,
    summary, products, sources, deliveries, comparePrevious,
    ...(comparePrevious ? { previous } : {}),
    definition: "Nhóm đơn tạo trong kỳ, trạng thái/số dư hiện tại. Doanh thu là tổng đơn đã hoàn tất (giao tận nơi hoặc nhận tại cửa hàng) gồm phí và giảm giá; tiền đã thu ròng là số thu trừ số hoàn của nhóm đơn. Không phải dòng tiền theo ngày thu, chưa có dữ liệu lợi nhuận. Lịch giao tính theo ngày giao và không bao gồm đơn nhận tại cửa hàng.",
  };
}

function normalized(message: string) {
  return message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}
export function requestsReportComparison(message: string) {
  const text = normalized(message);
  if (/\b(?:khong|dung)\s+(?:can\s+)?(?:so sanh|doi chieu)\b/.test(text)) return false;
  return /\b(?:so sanh|doi chieu|so voi|tang truong|tang giam|kem (?:ky|tuan|thang) truoc)\b/.test(text);
}

// Resolve only an unambiguous recent N-day request. Explicit dates and modified
// anchors stay with the tool's validated range rather than guessing intent.
export function resolveAIReportRange(message: string, range: { from: string; to: string }, today = hanoiDateKey()) {
  const text = normalized(message), matches = [...text.matchAll(/\b(\d{1,2})\s+ngay\s+(?:gan nhat|vua qua|qua)\b/g)];
  if (matches.length !== 1 || /\d{1,4}[-/]\d{1,2}|\b(?:hom qua|khong tinh hom nay|tru hom nay|ket thuc|tinh den|tu ngay|den ngay|thang)\b/.test(text)) return range;
  const days = Number(matches[0][1]);
  if (days < 1 || days > 93) return range;
  return { from: hanoiDateKey(parseDateTime(today).getTime() - (days - 1) * 86400000), to: today };
}
