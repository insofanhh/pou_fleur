import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { uploadFailure } from "@/lib/upload-errors";
import { MAX_IMAGE_BYTES } from "@/lib/product-images";
import { requirePermission, HttpError } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  let stage = "authorize";
  try {
    if (
      req.headers.get("origin") !==
      (process.env.APP_ORIGIN || req.nextUrl.origin)
    )
      throw new HttpError(403, "Nguồn yêu cầu không hợp lệ.");
    await requirePermission("products");
    if (
      Number(req.headers.get("content-length") || 0) >
      MAX_IMAGE_BYTES + 100000
    )
      throw new HttpError(413, "Ảnh tối đa 4 MB.");
    stage = "read-file";
    const form = await req.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > MAX_IMAGE_BYTES ||
      file.size < 16
    )
      throw new HttpError(400, "Chọn ảnh JPG, PNG hoặc WebP dưới 4 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    let ext = "";
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = "jpg";
    else if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      ext = "png";
    else if (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    )
      ext = "webp";
    if (!ext) throw new HttpError(400, "Định dạng ảnh không hợp lệ.");
    stage = "storage";
    const name = randomUUID() + "." + ext;
    if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
      const blob = await put("products/" + name, bytes, {
        access: "public",
        contentType: ext === "jpg" ? "image/jpeg" : "image/" + ext,
        addRandomSuffix: false,
      });
      return NextResponse.json({ url: blob.url });
    }
    if (process.env.VERCEL === "1")
      throw new HttpError(
        503,
        "Chưa kết nối kho ảnh Blob. Vui lòng Connect Blob store với dự án Vercel rồi redeploy.",
      );
    const dir = path.join(process.cwd(), "storage", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), bytes);
    return NextResponse.json({ url: "/uploads/" + name });
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    const failure = uploadFailure(e);
    const requestId = randomUUID();
    console.error("[product-upload]", {
      requestId,
      stage,
      code: failure.code,
      errorType: e instanceof Error ? e.constructor.name : "Unknown",
      hasBlobStore: !!process.env.BLOB_STORE_ID,
      hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json(
      {
        error: failure.message + " [" + failure.code + "; " + requestId + "]",
        code: failure.code,
        requestId,
      },
      { status: failure.status },
    );
  }
}
