import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processAIReminders } from "@/lib/ai-reminders";
import { processDomainEvents } from "@/lib/domain-events";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") || ""), expected = Buffer.from("Bearer " + (secret || ""));
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reminders = await processAIReminders();
    const notifications = await processDomainEvents(Date.now() + 15000);
    return NextResponse.json({ reminders, notifications }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Reminder worker failed" }, { status: 500 }); }
}
