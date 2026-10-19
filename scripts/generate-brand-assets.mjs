import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// SVG is the editable source. Keep safe padding for home-screen maskable icons.
const source = await readFile("public/brand/fleurious-mark.svg", "utf8");
await writeFile("app/icon.svg", source);
const geometry = source.replace(/^[\s\S]*?<\/title>/, "").replace(/<\/svg>\s*$/, "");
await writeFile("public/brand/fleurious-logo.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="322" height="72" viewBox="0 0 322 72" fill="none">
  <title>Fleurious</title>
  <g transform="translate(4 4)">${geometry}</g>
  <text x="82" y="53" fill="#181818" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="700" letter-spacing="-3">fleurious</text>
</svg>\n`);
for (const [path, size] of [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["app/apple-icon.png", 180],
]) {
  const mark = await sharp(Buffer.from(source))
    .resize(Math.round(size * 0.72))
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(path);
}
// PNG-compressed ICO entries are supported by current browsers and Windows.
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(source)).resize(size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const p = 6 + 16 * i;
  header[p] = sizes[i];
  header[p + 1] = sizes[i];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(images[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += images[i].length;
}
await writeFile("app/favicon.ico", Buffer.concat([header, ...images]));
console.log("Generated SVG favicon, multi-size ICO, Apple icon and PWA icons.");
