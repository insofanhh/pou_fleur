import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(name))
    return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(
      path.join(process.cwd(), "storage", "uploads", name),
    );
    const ext = name.split(".").at(-1);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type":
          ext === "jpg"
            ? "image/jpeg"
            : ext === "png"
              ? "image/png"
              : "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
