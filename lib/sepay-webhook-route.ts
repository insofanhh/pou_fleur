import { NextRequest, NextResponse } from "next/server";
import { processWebhook } from "./sepay";
import { HttpError } from "./auth";
import { withSystem } from "./tenant";

export async function handleSepayWebhook(req: NextRequest, storeId?: number) {
  try {
    if (process.env.SEPAY_WEBHOOK_ENABLED === "false") throw new HttpError(503, "Webhook đang tạm tắt.");
    if (Number(req.headers.get("content-length") || 0) > 100000) throw new HttpError(413, "Dữ liệu quá lớn.");
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > 100000) throw new HttpError(413, "Dữ liệu quá lớn.");
    const body = JSON.parse(raw);
    return NextResponse.json(await withSystem(() => processWebhook(raw, body, req.headers, storeId)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Dữ liệu webhook không hợp lệ." }, { status: 400 });
    console.error("SePay webhook failure", { code: (error as { code?: string }).code || "unknown" });
    return NextResponse.json({ error: "Không thể xử lý webhook. Vui lòng thử lại." }, { status: 500 });
  }
}
