import { NextRequest, NextResponse } from "next/server";
import { handleSepayWebhook } from "@/lib/sepay-webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const id = Number(storeId);
  if (!/^\d+$/.test(storeId) || !Number.isSafeInteger(id) || id < 1)
    return NextResponse.json({ error: "Cửa hàng không hợp lệ." }, { status: 400 });
  return handleSepayWebhook(req, id);
}
