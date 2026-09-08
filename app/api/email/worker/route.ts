import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processEmails } from "@/lib/email";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from("Bearer " + (secret || ""));
  if (
    !secret ||
    secret.length < 32 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await processEmails(100), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Email worker failed" }, { status: 500 });
  }
}
