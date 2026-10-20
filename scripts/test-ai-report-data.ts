import assert from "node:assert/strict";
import { loadAIReport, requestsReportComparison, resolveAIReportRange } from "../lib/ai-report-data";
import { analyticsQueries, analyticsPeriod } from "../lib/store-analytics";
import { hanoiDateKey } from "../lib/date-time";
import { aiImageSchema, aiUserContent } from "../lib/ai-images";
import { safeAIImageURL, supportsAIImages } from "../lib/ai-image-policy";

async function main() {
  const rows = [
    { day: "2026-10-06", status: "delivered", orders_count: 999, revenue: 999000 },
    { day: "2026-10-07", status: "delivered", orders_count: 100, revenue: 5000000 },
    { day: "2026-10-13", status: "cancelled", orders_count: 50, gross_value: 1000000 },
    { day: "2026-10-14", status: "delivered", orders_count: 2, revenue: 250000, collected: 200000, gross_value: 250000, order_value: 250000 },
    { day: "2026-10-20", status: "confirmed", orders_count: 1, outstanding: 100000, gross_value: 100000, order_value: 100000 },
    { day: "2026-10-21", status: "delivered", orders_count: 888, revenue: 888000 },
  ];
  const calls: unknown[][] = [];
  const read = async (sql: string, args: unknown[] = []) => {
    calls.push([sql, ...args]);
    return sql === analyticsQueries.orders ? rows.filter(row => row.day >= String(args[0]) && row.day <= String(args[1])).map(row => ({ ...row, creation_source: "manual", sales_channel: "zalo", payment_method: "bank" })) : [];
  };
  const normal = await loadAIReport("2026-10-14", "2026-10-20", 17, read);
  assert.deepEqual(normal.period, { from: "2026-10-14", to: "2026-10-20", days: 7 });
  assert(!("previous" in normal));
  assert.deepEqual(calls[0].slice(1), ["2026-10-14", "2026-10-20"]);
  assert.equal(normal.summary.orders_count, 3);
  assert.equal(normal.summary.revenue, 250000);
  assert.equal(normal.summary.collected, 200000);
  assert.equal(normal.summary.outstanding, 100000);
  assert.equal(normal.summary.delivered, 2);
  assert.equal(normal.summary.cancellations, 0);
  assert.equal(normal.sources!.reduce((sum, row) => sum + row.orders_count, 0), 3);
  calls.length = 0;
  const comparison = await loadAIReport("2026-10-14", "2026-10-20", 17, read, true);
  assert.deepEqual(comparison.summary, normal.summary, "Comparison never changes the requested period totals");
  assert.equal(comparison.previous?.orders_count, 150);
  assert.equal(comparison.previous?.revenue, 5000000);
  assert.equal(comparison.previous?.cancellations, 50);
  assert.equal(comparison.period.previousFrom, "2026-10-07");
  assert.equal(comparison.period.previousTo, "2026-10-13");
  assert.deepEqual(calls[0].slice(1), ["2026-10-07", "2026-10-20"]);
  const input = { from: "2026-10-13", to: "2026-10-20" };
  assert.deepEqual(resolveAIReportRange("Báo cáo hoạt động trong 7 ngày gần nhất", input, "2026-10-20"), { from: "2026-10-14", to: "2026-10-20" });
  assert.deepEqual(resolveAIReportRange("1 ngày gần nhất", input, "2026-10-20"), { from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(resolveAIReportRange("7 ngày gần nhất", input, "2026-01-03"), { from: "2025-12-28", to: "2026-01-03" });
  assert.deepEqual(resolveAIReportRange("3 ngày gần nhất", input, "2028-03-01"), { from: "2028-02-28", to: "2028-03-01" });
  assert.deepEqual(resolveAIReportRange("7 ngày gần nhất", input, hanoiDateKey("2026-10-20T17:01:00Z")), { from: "2026-10-15", to: "2026-10-21" });
  for (const text of ["7 ngày gần nhất đến ngày 01/10/2026", "7 ngày gần nhất không tính hôm nay", "7 ngày qua và 30 ngày qua", "báo cáo từ 01-10 đến 03-10", "báo cáo tháng trước"]) assert.deepEqual(resolveAIReportRange(text, input, "2026-10-20"), input);
  assert.equal(analyticsPeriod("2026-10-14", "2026-10-20").days, 7);
  assert(requestsReportComparison("So sánh 7 ngày gần nhất với kỳ trước"));
  assert(requestsReportComparison("Đối chiếu doanh thu so với tuần trước"));
  for (const text of ["Báo cáo 7 ngày gần nhất", "Báo cáo tuần trước", "Không cần so sánh, chỉ báo cáo 7 ngày gần nhất"]) assert(!requestsReportComparison(text));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=";
  assert(aiImageSchema.safeParse({ name: "Ảnh.png", dataUrl: png }).success);
  for (const dataUrl of ["https://example.test/private.png", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,bm90IGFuIGltYWdl", "data:image/png;base64," + "A".repeat(800000)]) assert(!aiImageSchema.safeParse({ name: "Ảnh", dataUrl }).success);
  assert(!safeAIImageURL("data:text/html;base64,PHNjcmlwdD4="));
  assert(supportsAIImages("deepseek-flash") && !supportsAIImages("deepseek-v4-pro"));
  assert.deepEqual(aiUserContent("Không có ảnh", []), "Không có ảnh");
  assert.deepEqual(aiUserContent("Đọc ảnh", [{ name: "Ảnh", dataUrl: png }]), [{ type: "text", text: "Đọc ảnh" }, { type: "image_url", image_url: { url: png } }]);
  console.log("PASS AI report: exact 7 inclusive Hanoi days, midnight/leap/year boundaries, current vs previous SQL/amount/count isolation, explicit comparisons; private image validation and provider content");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
