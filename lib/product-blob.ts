import { getVercelOidcToken } from "@vercel/oidc";

// Keep product uploads isolated from other stores connected with BLOB_*.
// Explicit credentials also prevent the SDK from falling back to those stores.
export async function productBlobAuth(
  env: Record<string, string | undefined> = process.env,
  getOidc: () => Promise<string> = getVercelOidcToken,
) {
  const token = env.BLD_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = env.BLD_STORE_ID?.trim();
  if (!storeId) return null;
  let oidcToken: string;
  try {
    oidcToken = (await getOidc()).trim();
  } catch {
    throw new Error(
      "No blob credentials for BLD_STORE_ID: Vercel OIDC unavailable.",
    );
  }
  if (!oidcToken)
    throw new Error(
      "No blob credentials for BLD_STORE_ID: empty Vercel OIDC token.",
    );
  return { storeId, oidcToken };
}
