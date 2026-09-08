import assert from "node:assert/strict";
import { uploadFailure } from "../lib/upload-errors";
const cases = [
  [
    "Vercel Blob: Cannot use public access on a private store. The store is configured with private access.",
    "BLOB_ACCESS_MODE",
  ],
  [
    "OIDC is enabled for this project, but not for this token's environment.",
    "BLOB_ENVIRONMENT",
  ],
  ["Vercel Blob: No blob credentials found.", "BLOB_AUTH"],
  [
    "Vercel Blob: Access denied, please provide a valid token for this resource.",
    "BLOB_AUTH",
  ],
  ["Vercel Blob: This store does not exist.", "BLOB_STORE_MISSING"],
  ["Vercel Blob: This store has been suspended.", "BLOB_SUSPENDED"],
  ["fetch failed", "BLOB_UNAVAILABLE"],
  ["unexpected credential=SECRET_TEST_VALUE", "UPLOAD_FAILED"],
];
for (const [message, code] of cases) {
  const result = uploadFailure(new Error(message));
  assert.equal(result.code, code);
  assert.ok(!JSON.stringify(result).includes("SECRET_TEST_VALUE"));
}
console.log(
  "8 upload diagnostic cases passed; raw error details are not exposed.",
);
