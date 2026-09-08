import assert from "node:assert/strict";
import { productBlobAuth } from "../lib/product-blob";

async function main() {
  const oldStore = {
    BLOB_STORE_ID: "store_other",
    BLOB_READ_WRITE_TOKEN: "other-token",
  };
  const noOidc = async (): Promise<string> => {
    throw Error("Unavailable");
  };
  assert.equal(await productBlobAuth(oldStore, noOidc), null);
  assert.deepEqual(
    await productBlobAuth(
      { ...oldStore, BLD_STORE_ID: "store_flowers" },
      async () => "oidc-test",
    ),
    { storeId: "store_flowers", oidcToken: "oidc-test" },
  );
  assert.deepEqual(
    await productBlobAuth(
      { ...oldStore, BLD_READ_WRITE_TOKEN: "flower-token" },
      noOidc,
    ),
    { token: "flower-token" },
  );
  assert.deepEqual(
    await productBlobAuth(
      {
        ...oldStore,
        BLD_STORE_ID: "store_flowers",
        BLD_READ_WRITE_TOKEN: "flower-token",
      },
      noOidc,
    ),
    { token: "flower-token" },
  );
  await assert.rejects(
    () =>
      productBlobAuth({ ...oldStore, BLD_STORE_ID: "store_flowers" }, noOidc),
    /No blob credentials/,
  );
  await assert.rejects(
    () =>
      productBlobAuth(
        { ...oldStore, BLD_STORE_ID: "store_flowers" },
        async () => " ",
      ),
    /No blob credentials/,
  );
  assert.equal(
    await productBlobAuth(
      { ...oldStore, BLD_STORE_ID: " ", BLD_READ_WRITE_TOKEN: " " },
      noOidc,
    ),
    null,
  );
  console.log("7 Blob prefix isolation checks passed.");
}
void main();
