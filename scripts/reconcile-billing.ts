import { advanceBilling } from "../lib/billing";
import { pool } from "../lib/db";

if (
  !["localhost", "127.0.0.1"].includes(process.env.MYSQL_HOST || "127.0.0.1") &&
  !process.argv.includes("--production-backup-verified")
) {
  throw new Error(
    "Remote billing migration requires --production-backup-verified after a restore drill",
  );
}
advanceBilling()
  .then((result) =>
    console.log("Billing reconciled; emails queued only.", result),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
