import { mkdir, writeFile } from "node:fs/promises";
const assets = {
  hero: "1654666132010-938fc58af64d",
  tulips: "1615216300340-86ddd7b31555",
  roses: "1553578622-34d24027ce18",
  daisies: "1618429490678-6ccbfb7f515f",
  blush: "1579532648866-611dbe281eeb",
  vase: "1615379356778-1306a1a2d7f9",
  joy: "1677864390498-c9cb752af261",
};
await mkdir("public/images", { recursive: true });
await Promise.all(
  Object.entries(assets).map(async ([name, id]) => {
    const url =
      "https://images.unsplash.com/photo-" +
      id +
      "?auto=format&fit=crop&w=" +
      (name === "hero" ? 1600 : 1000) +
      "&q=85";
    const r = await fetch(url);
    if (!r.ok || !r.headers.get("content-type")?.startsWith("image/"))
      throw Error(name + " failed " + r.status);
    const b = Buffer.from(await r.arrayBuffer());
    await writeFile("public/images/" + name + ".jpg", b);
    console.log(name + ": " + b.length + " bytes");
  }),
);
