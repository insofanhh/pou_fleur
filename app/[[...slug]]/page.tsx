import { catalog } from "@/lib/db";
import Store from "@/components/store";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
const titles: Record<string, string> = {
  shop: "Khám phá hoa",
  cart: "Giỏ hàng",
  checkout: "Đặt hoa",
  login: "Đăng nhập",
  register: "Đăng ký",
  account: "Tài khoản",
  wishlist: "Hoa yêu thích",
  journal: "Chuyện về hoa",
  events: "Bộ sưu tập",
  about: "Về Fleur",
  contact: "Liên hệ",
  policies: "Chính sách",
  privacy: "Quyền riêng tư",
  faq: "Câu hỏi thường gặp",
  "track-order": "Theo dõi đơn hàng",
  "forgot-password": "Khôi phục tài khoản",
  "reset-password": "Đặt lại mật khẩu",
  admin: "Fleur Workspace",
};
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  if (slug[0] === "product") {
    const data = await catalog();
    const p = data.products.find((p) => p.slug === slug[1]);
    return {
      title: p?.name || "Không tìm thấy sản phẩm",
      description: p?.description,
    };
  }
  if (slug[0] === "journal" && slug[1]) {
    const data = await catalog();
    const p = data.posts.find((p) => p.slug === slug[1]);
    return {
      title: p?.title || "Không tìm thấy bài viết",
      description: p?.excerpt,
    };
  }
  return {
    title: titles[slug[0]] || "Fleur — Hoa cho những điều không thể nói",
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const data = await catalog();
  if (slug.length) {
    if (slug[0] === "product") {
      if (slug.length !== 2 || !data.products.some((p) => p.slug === slug[1]))
        notFound();
    } else if (slug[0] === "journal") {
      if (
        slug.length > 2 ||
        (slug[1] && !data.posts.some((p) => p.slug === slug[1]))
      )
        notFound();
    } else if (slug[0] === "admin") {
      if (slug.length > 2) notFound();
    } else if (
      !titles[slug[0]] ||
      (slug.length > 1 &&
        !(slug[0] === "account" && slug[1] === "orders" && slug.length === 2))
    )
      notFound();
  }
  return <Store data={data} />;
}
