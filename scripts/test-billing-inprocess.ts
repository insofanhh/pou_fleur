// Exercise the real Next API handlers with auth/cookies and SQL; no HTTP server,
// customer emails, push delivery or bank/provider calls are started by this runner.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

async function main() {
  assert(process.env.MYSQL_DATABASE === "fleur_saas_test" && process.env.MYSQL_PORT === "3310" && ["localhost", "127.0.0.1"].includes(process.env.MYSQL_HOST || "127.0.0.1"), "Isolated local QA database only");
  const suite = process.argv[2] || "experience";
  assert(["experience", "plan-changes", "trial-billing", "account-trials", "platform-overview", "platform-invoices", "workspace-navigation"].includes(suite));
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
  process.env.TEST_ORIGIN = "http://127.0.0.1:3005";
  process.env.APP_ORIGIN = process.env.TEST_ORIGIN;
  process.env.EMAIL_ENABLED = "false";
  const { createRequestStore } = await import("next/dist/server/async-storage/request-store.js");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
  const { NextRequest } = await import("next/server");
  const api = await import("../app/api/[...path]/route");
  const sepay = await import("../app/api/sepay/webhook/route");
  globalThis.fetch = async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url || String(input));
    assert.equal(url.origin, process.env.TEST_ORIGIN, "No external network calls in billing QA");
    const request = new NextRequest(url, init), cookies: string[] = [];
    const store = createRequestStore({ phase: "action", headers: request.headers, url, rootParams: {}, implicitTags: { tags: [], expirationsByCacheKind: new Map() } as any, resumeDataCache: null, onUpdateCookies: values => { cookies.splice(0, cookies.length, ...values); }, previewProps: undefined, isHmrRefresh: undefined, serverComponentsHmrCache: undefined, hmrRefreshHash: undefined, stagedFallbackParams: null });
    const work = { route: url.pathname, isStaticGeneration: false, incrementalCache: {}, afterContext: { after() {} } } as any;
    const response = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => url.pathname === "/api/sepay/webhook" ? sepay.POST(request) : api.GET(request, { params: Promise.resolve({ path: url.pathname.slice(5).split("/") }) })));
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  };
  if (suite === "workspace-navigation") await import("./test-workspace-navigation");
  else if (suite === "platform-invoices") await import("./test-platform-invoices");
  else if (suite === "platform-overview") await import("./test-platform-overview");
  else if (suite === "experience") await import("./test-experience");
  else if (suite === "plan-changes") await import("./test-plan-changes");
  else if (suite === "trial-billing") await import("./test-trial-billing");
  else await import("./test-account-trials");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
