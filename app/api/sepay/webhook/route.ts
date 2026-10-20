import { NextRequest } from "next/server";
import { handleSepayWebhook } from "@/lib/sepay-webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleSepayWebhook(req);
}
