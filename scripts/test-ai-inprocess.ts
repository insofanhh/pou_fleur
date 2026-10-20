// Run the actual API handlers against the isolated QA DB, without opening a
// server port. Only DeepSeek transport is mocked; auth/tenant/SQL/actions are real.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

async function main() {
  assert(process.env.MYSQL_DATABASE === "fleur_saas_test" && process.env.MYSQL_PORT === "3310" && ["127.0.0.1", "localhost"].includes(process.env.MYSQL_HOST || "127.0.0.1"), "Isolated local QA database only");
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
  process.env.TEST_ORIGIN = "http://127.0.0.1:3005";
  process.env.APP_ORIGIN = process.env.TEST_ORIGIN;
  process.env.TEST_SKIP_UI = "true";
  process.env.EMAIL_ENABLED = "false";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "isolated-qa-ai-master-" + "x".repeat(32);
  process.env.CRON_SECRET = "isolated-qa-ai-cron-" + "x".repeat(32);
  await import("./test-ai-provider-mock.mjs");
  const transport = globalThis.fetch;
  const { createRequestStore } = await import("next/dist/server/async-storage/request-store.js");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
  const { NextRequest } = await import("next/server");
  const api = await import("../app/api/[...path]/route");
  const reminders = await import("../app/api/ai/reminders/route");
  globalThis.fetch = async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url || String(input));
    if (url.origin !== process.env.TEST_ORIGIN) {
      assert(url.href === "https://api.deepseek.com/chat/completions", "No external transport in in-process QA");
      return transport(input, init);
    }
    const request = new NextRequest(url, init);
    const cookieHeaders: string[] = [];
    const store = createRequestStore({ phase: "action", headers: request.headers, url, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() } as any, resumeDataCache: null, onUpdateCookies: values => { cookieHeaders.splice(0, cookieHeaders.length, ...values); }, previewProps: undefined, isHmrRefresh: undefined, serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, stagedFallbackParams: null });
    const work = { route: url.pathname, isStaticGeneration: false, afterContext: { after() { /* Workers are exercised explicitly by the suite; no SMTP/push delivery here. */ } } } as any;
    const response = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => url.pathname === "/api/ai/reminders"
      ? reminders.GET(request)
      : api.GET(request, { params: Promise.resolve({ path: url.pathname.slice(5).split("/") }) })));
    for (const cookie of cookieHeaders) response.headers.append("set-cookie", cookie);
    return response;
  };
  await import("./test-ai-integration");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
