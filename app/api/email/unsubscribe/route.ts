import { NextRequest } from "next/server";
import { unsubscribeEmail } from "@/lib/email";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};
function page(content: string, status = 200) {
  return new Response(
    '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email Fleur</title><body style="font-family:Arial,sans-serif;background:#f5f5f7;padding:40px;line-height:1.7"><main style="max-width:560px;margin:60px auto;background:white;padding:32px;border-radius:20px"><h1>fleur®</h1>' +
      content +
      "</main></body></html>",
    { status, headers },
  );
}
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token))
    return page("<p>Liên kết không hợp lệ.</p>", 400);
  return page(
    '<h2>Hủy nhận email chương trình?</h2><p>Bạn vẫn nhận thông báo về đơn hàng đã đặt.</p><form method="post"><button type="submit" style="background:#111;color:#fff;border:0;padding:14px 22px;border-radius:24px">Xác nhận hủy đăng ký</button></form>',
  );
}
export async function POST(req: NextRequest) {
  try {
    const ok = await unsubscribeEmail(
      req.nextUrl.searchParams.get("token") || "",
    );
    return page(
      ok
        ? "<h2>Đã hủy đăng ký.</h2><p>Fleur đã ngừng gửi email chương trình đến bạn. Thông báo đơn hàng vẫn hoạt động.</p>"
        : "<p>Liên kết không hợp lệ.</p>",
      ok ? 200 : 400,
    );
  } catch {
    return page("<p>Chưa thể cập nhật. Vui lòng thử lại.</p>", 503);
  }
}
