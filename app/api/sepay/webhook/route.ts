import { NextRequest, NextResponse } from "next/server";
import { processWebhook } from "@/lib/sepay";
import { HttpError } from "@/lib/auth";
import { withSystem } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (process.env.SEPAY_WEBHOOK_ENABLED === "false") return NextResponse.json({ error: "Webhook đang tạm tắt." }, { status: 503 });
    const raw = await req.text();
    const body = JSON.parse(raw);
    return NextResponse.json(await withSystem(() => processWebhook(raw, body, req.headers)));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("SePay webhook failure", e);
    return NextResponse.json({ error: "Webhook không hợp lệ." }, { status: 400 });
  }
}
