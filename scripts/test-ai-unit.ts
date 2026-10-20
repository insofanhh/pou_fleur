import assert from "node:assert/strict";
import { aiMonth, aiPlanAllowed, defaultAIAllowance, aiAllowance, noteInput, reminderInput, validDay, redactAISecrets, normalizeAICurrency } from "../lib/ai-policy";
import { deepseekCompletion, AIProviderError } from "../lib/ai-provider";
import { sealAIKey, openAIKey } from "../lib/ai-config";
import { aiTools } from "../lib/ai-tools";
import { scopedSQL, withStore } from "../lib/tenant";
import { pool } from "../lib/db";
let checks = 0;
function check(v: unknown, title: string) { assert(v, title); console.log("PASS", title); checks++; }
async function main() {
  check(aiPlanAllowed(1) && aiPlanAllowed(2) && aiPlanAllowed(3) && !aiPlanAllowed(4) && !aiPlanAllowed(0), "Stable plan IDs allow Starter, Studio and Atelier only");
  check(defaultAIAllowance(1) === 50 && defaultAIAllowance(2) === 300 && defaultAIAllowance(3) === 1500, "Default monthly allowances 50/300/1500");
  check(aiAllowance(1, {}) === 50 && aiAllowance(2, {}) === 300 && aiAllowance(3, {}) === 1500, "Legacy missing quotas use tier defaults");
  check(aiAllowance(1, { ai_messages: 0 }) === 0 && aiAllowance(1, { ai_messages: 27 }) === 27 && aiAllowance(4, { ai_messages: 20 }) === 0, "Explicit zero and custom quotas remain authoritative");
  check([-1, 1.5, 100001, "invalid", Infinity].every(value => aiAllowance(1, { ai_messages: value }) === 0), "Invalid persisted quotas fail closed");
  check(aiMonth(Date.parse("2026-10-31T17:00:00Z")) === "2026-11", "Quota month uses Hanoi midnight");
  check(normalizeAICurrency("215.000 ₫ và 200000đ, đơn hàng") === "215.000 VNĐ và 200000 VNĐ, đơn hàng", "AI currency output follows VNĐ convention");
  check(!validDay.safeParse("2026-02-30").success && validDay.safeParse("2028-02-29").success, "Invalid calendar dates rejected");
  check(!noteInput.safeParse({ title: "note", day: "2026-10-20", storeId: 9 }).success, "Tools reject injected tenant fields");
  check(!reminderInput.safeParse({ title: "nhắc", dueAt: "2026-10-20T12:00:00" }).success, "Reminder times require explicit timezone");
  check(!redactAISecrets("api_key=secret Bearer TOKEN sk-1234567890").includes("secret"), "Known secret patterns redacted");
  const prior = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "unit-only-master-" + "x".repeat(32);
  const sealed = sealAIKey("unit-dummy-key");
  check(sealed !== "unit-dummy-key" && openAIKey(sealed) === "unit-dummy-key" && sealed !== sealAIKey("unit-dummy-key"), "Credentials use authenticated encryption and random nonce");
  assert.throws(() => openAIKey(sealed.slice(0, -4) + "xxxx")); checks++;
  if (prior === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = prior;
  check(aiTools({ role: "editor" }).length === 0 && !aiTools({ role: "support" }).some(t => t.function.name === "get_store_metrics"), "Model receives only role-allowed tools");
  check(!aiTools({ role: "owner" }).some(t => /confirm|payment|refund|delete|sql/.test(t.function.name)), "No write-confirmation/payment/SQL tools exposed to model");
  for (const sql of ["SELECT a.* FROM ai_action_drafts a JOIN ai_conversations c ON c.id=a.conversation_id WHERE a.id=? FOR UPDATE", "UPDATE ai_runs SET status='failed' WHERE status='running' AND lease_until<=UTC_TIMESTAMP()", "INSERT INTO ai_messages(conversation_id,run_id,role,content,cards) VALUES(?,?,'user',?,NULL)"]) {
    const scoped = withStore(17, () => scopedSQL(sql)); check(scoped.includes("17") && scoped.includes("store_id"), "AI SQL scopes " + sql.split(" ")[0]);
  }
  assert.throws(() => scopedSQL("SELECT * FROM ai_messages")); checks++;
  const run = (transport: typeof fetch) => deepseekCompletion("dummy", "deepseek-flash", [{ role: "user", content: "test" }], [], 100, AbortSignal.timeout(1000), transport);
  const success = (message: any, finish_reason = "stop") => (async (_url: any, init: any) => { check(!JSON.parse(init.body).stream && init.headers.Authorization === "Bearer dummy", "Provider request uses server authentication and bounded completion"); return Response.json({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 12, completion_tokens: 3 } }); }) as typeof fetch;
  check((await run(success({ content: "Đã tra cứu" }))).inputTokens === 12, "Provider normal response and token accounting");
  check((await run(success({ content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "search_help", arguments: "{}" } }] }, "tool_calls"))).message.tool_calls?.length === 1, "Provider tool-call response validated");
  for (const status of [401, 402, 403, 429, 500]) { await assert.rejects(run((async () => new Response("sk-sensitive-do-not-leak", { status })) as typeof fetch), (e: any) => e instanceof AIProviderError && !e.message.includes("sensitive")); checks++; }
  await assert.rejects(run((async () => Response.json({ bad: true })) as typeof fetch), AIProviderError); checks++;
  await assert.rejects(run((async () => { throw Error("network secret"); }) as typeof fetch), AIProviderError); checks++;
  await assert.rejects(run(success({ content: "truncated" }, "length")), AIProviderError); checks++;
  console.log(`${checks} AI unit checks passed`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
