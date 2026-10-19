import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { APP_TIME_ZONE, APP_TIME_ZONE_LABEL, HANOI_LOCATION } from "../lib/regional";
import { formatDate, formatDateTime, hanoiDateKey, hanoiDateTimeInput, hanoiInputToISO, parseDateTime } from "../lib/date-time";
import { goongSearchLocation } from "../lib/goong-config";
import { nextBillingInstant } from "../lib/billing";
import { pool } from "../lib/db";

if (!process.argv.includes("--child")) {
  for (const TZ of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", import.meta.filename, "--child"], {
      env: { ...process.env, TZ }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    process.stdout.write(result.stdout);
  }
} else {
  assert.equal(APP_TIME_ZONE, "Asia/Ho_Chi_Minh");
  assert.equal(APP_TIME_ZONE_LABEL, "Hà Nội (UTC+7)");
  assert.equal(hanoiDateKey("2026-10-18T16:59:59Z"), "2026-10-18");
  assert.equal(hanoiDateKey("2026-10-18T17:00:00Z"), "2026-10-19");
  assert.equal(hanoiDateKey("2026-12-31T17:00:00Z"), "2027-01-01");
  assert.equal(hanoiDateKey("2026-02-28T17:00:00Z"), "2026-03-01");
  assert.equal(hanoiDateKey("2028-02-28T17:00:00Z"), "2028-02-29");
  assert.equal(parseDateTime("2026-10-19 00:05:00").toISOString(), "2026-10-18T17:05:00.000Z");
  assert.equal(parseDateTime("2026-10-19 00:05:00", "utc").toISOString(), "2026-10-19T00:05:00.000Z");
  assert.equal(parseDateTime("2026-10-19T00:05:00+07:00", "utc").toISOString(), "2026-10-18T17:05:00.000Z");
  assert.equal(formatDate("2026-10-19"), "19/10/2026");
  assert.equal(formatDateTime("2026-10-18 17:05:00", "utc"), formatDateTime("2026-10-19 00:05:00"));
  assert.equal(formatDateTime(null), "—");
  assert.equal(formatDateTime("invalid"), "—");
  assert.equal(hanoiDateTimeInput("2026-10-18T17:05:00Z"), "2026-10-19T00:05");
  assert.equal(hanoiDateTimeInput("2026-10-19 00:05:00", "hanoi"), "2026-10-19T00:05");
  assert.equal(hanoiInputToISO("2026-10-19T00:05"), "2026-10-18T17:05:00.000Z");
  assert.equal(hanoiDateTimeInput(hanoiInputToISO("2026-10-19T14:30")), "2026-10-19T14:30");
  assert.equal(goongSearchLocation(null, null), `${HANOI_LOCATION.lat},${HANOI_LOCATION.lng}`);
  assert.equal(goongSearchLocation("invalid", "105"), "21.0278,105.8342");
  assert.equal(goongSearchLocation("91", "105"), "21.0278,105.8342");
  assert.equal(goongSearchLocation("", ""), "21.0278,105.8342");
  assert.equal(goongSearchLocation("10.77", "106.7"), "10.77,106.7");
  assert.equal(goongSearchLocation("0", "0"), "0,0");
  assert.equal(nextBillingInstant("2026-01-30 17:30:00"), "2026-02-27 17:30:00");
  assert.equal(nextBillingInstant("2026-01-31 17:30:00"), "2026-02-28 17:30:00");
  console.log(`PASS Hanoi dates, midnight/month/year boundaries, received-time roundtrip, Goong defaults: ${process.env.TZ}`);
}
void pool.end();
