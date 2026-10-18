import { processAutomations } from "@/lib/automations";
import { processIdentityMail } from "@/lib/identity-mail";
import { advanceBilling } from "@/lib/billing";
import { processDomainEvents } from "@/lib/domain-events";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processAllStoreEmails } from "@/lib/email";
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
    const deadline = Date.now() + 45000;
    const automations = await processAutomations();
    const billing = await advanceBilling();
    const identity = await processIdentityMail();
    const notifications = await processDomainEvents(
      Math.min(deadline, Date.now() + 8000),
    );
    const emails = await processAllStoreEmails(deadline);
    return NextResponse.json(
      { automations, billing, identity, notifications, emails },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Email worker failed" }, { status: 500 });
  }
}
