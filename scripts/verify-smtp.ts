import { pool } from "../lib/db";
import { emailConfiguration, verifySMTP, safeMailError } from "../lib/email";
async function main() {
  const config = emailConfiguration();
  if (!config.ready) throw Error("SMTP_NOT_CONFIGURED");
  await verifySMTP();
  console.log("SMTP connection and authentication succeeded. No email sent.");
}
main()
  .catch((error) => {
    console.error(safeMailError(error));
    console.error(
      "Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL and APP_ORIGIN.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
