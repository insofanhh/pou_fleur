import assert from "node:assert/strict";
import { parseWebhook } from "../lib/sepay";
import { pool } from "../lib/db";

let checks = 0;
const base = { id: "sepay-parser-qa", transferAmount: 139000, transferType: "in" };
function valid(fields: object, code = "FLR-SUB-30012-01408E") {
  assert.equal(parseWebhook({ ...base, ...fields }).code, code);
  checks++;
}
function invalid(fields: object, message: RegExp) {
  assert.throws(() => parseWebhook({ ...base, ...fields }), message);
  checks++;
}
async function main() {
  // Regression: TPBank strips all dashes and SePay leaves `code` null.
  valid({ code: null, content: "FLRSUB3001201408E", description: "BankAPINotify FLRSUB3001201408E" });
  valid({ content: "FLR-SUB-30012-01408E" });
  valid({ content: "Thanh toan flrsub3001201408e. Cam on" });
  valid({ content: "", code: "FLRSUB3001201408E" });
  valid({ content: "Thanh toan", code: "FLR-SUB-30012-01408E" });
  valid({ content: "", code: null, description: "BankAPINotify FLRSUB3001201408E" });
  valid({ content: "FLR SUB 30012 01408E" });
  valid({ content: "FLR–SUB–30012–01408E" });
  valid({ code: "FLRSUB3001201408E", content: "FLR-SUB-30012-01408E" });
  valid({ content: "FLRORD1234567890123456" }, "FLR-ORD-1234567890-123456");
  valid({ content: "FLR-ORD-9-ABCDEF" }, "FLR-ORD-9-ABCDEF");
  valid({ content: "FLRSUB1012345" }, "FLR-SUB-1-012345");
  invalid({ content: "FLRSUB3001201408E", code: "FLR-SUB-30013-ABCDEF" }, /nhiều mã/);
  invalid({ content: "FLRSUB3001201408E FLR-ORD-9-ABCDEF" }, /nhiều mã/);
  invalid({ content: "FLR-SUB-30012-01408" }, /Không tìm thấy mã/);
  invalid({ content: "FLR-SUB-30012-01408EZ" }, /Không tìm thấy mã/);
  invalid({ content: "FLR-SUB-30012-01408EA" }, /Không tìm thấy mã/);
  invalid({ content: "XFLRSUB3001201408E" }, /Không tìm thấy mã/);
  invalid({ content: "Chuyen tien", referenceCode: "FLRSUB3001201408E" }, /Không tìm thấy mã/);
  invalid({ content: "FLRSUB3001201408E", transferType: "out" }, /không hợp lệ/);
  invalid({ content: "FLRSUB3001201408E", transferAmount: 0 }, /không hợp lệ/);
  assert.throws(() => parseWebhook(null), /không hợp lệ/); checks++;
  const dated = parseWebhook({ ...base, content: "FLRSUB3001201408E", transactionDate: "2026-10-19 22:43:42" });
  assert.equal(dated.receivedAt, "2026-10-19 15:43:42"); checks++;
  console.log(`PASS ${checks} SePay parsing checks`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
