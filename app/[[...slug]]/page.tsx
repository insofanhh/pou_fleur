import { catalogForRoute } from "@/lib/catalog";
import Store from "@/components/store";
import Marketplace, { StartStore } from "@/components/marketplace";
import Platform from "@/components/platform";
import MultiCart from "@/components/multi-cart";
import { Inbox, Join } from "@/components/pwa";
import { storeBy, publicStore } from "@/lib/stores";
import { currentUser } from "@/lib/auth";
import { withStore } from "@/lib/tenant";
import { activeBank } from "@/lib/sepay";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
const valid = [
  "shop",
  "product",
  "cart",
  "checkout",
  "wishlist",
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "account",
  "journal",
  "events",
  "about",
  "contact",
  "policies",
  "privacy",
  "faq",
  "track-order",
  "admin",
];
async function route(slug: string[]) {
  let ref = "1",
    parts = slug;
  if (slug[0] === "s") {
    ref = slug[1];
    parts = slug.slice(2);
  }
  if (slug[0] === "workspace") {
    ref = slug[1];
    parts = ["admin", ...slug.slice(2)];
  }
  const store = await storeBy(ref).catch(() => null);
  if (!store) notFound();
  if (slug[0] === "s" && store.status !== "approved") {
    const u = await currentUser();
    if (!u?.memberships?.some((m) => m.store_id === store.id)) notFound();
  }
  return { store, parts };
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  if (!slug.length) return { title: "Fleurious — Những tiệm hoa gần bạn" };
  if (["platform", "start", "inbox", "join"].includes(slug[0]))
    return { title: "Fleurious · " + slug[0] };
  const { store, parts } = await route(slug);
  return withStore(store.id, async () => {
    const data = await catalogForRoute(parts[0] || "", parts[1] || "");
    const p = data.products.find((p) => p.slug === parts[1]);
    return {
      title: (p?.name || store.name) + " · Fleurious",
      description: p?.description || store.description,
    };
  });
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  if (!slug.length) return <Marketplace />;
  if (slug[0] === "cart" && slug.length === 1) return <MultiCart />;
  if (slug[0] === "start" && slug.length === 1) return <StartStore />;
  if (slug[0] === "inbox" && slug.length === 1) return <Inbox />;
  if (slug[0] === "join" && slug.length === 1) return <Join />;
  if (
    slug[0] === "platform" &&
    slug.length <= 2 &&
    (!slug[1] ||
      ["overview", "plans", "stores", "invoices", "users", "health", "config"].includes(slug[1]))
  )
    return <Platform area={slug[1] || "overview"} />;
  const { store, parts } = await route(slug);
  // The manual-order editor is a nested workspace route; other routes keep their limits.
  const manualEditor =
    ["workspace", "admin"].includes(slug[0]) &&
    parts.join("/") === "admin/orders/new";
  if (
    !manualEditor &&
    parts.length &&
    (!valid.includes(parts[0]) ||
      parts.length > 2 ||
      (parts.length === 2 &&
        !["product", "journal", "admin", "account"].includes(parts[0])))
  )
    notFound();
  return withStore(store.id, async () => {
    const data = await catalogForRoute(parts[0] || "", parts[1] || "");
    if (
      parts[0] === "product" &&
      !data.products.some((p) => p.slug === parts[1])
    )
      notFound();
    if (
      parts[0] === "journal" &&
      parts[1] &&
      !data.posts.some((p) => p.slug === parts[1])
    )
      notFound();
    return (
      <Store
        data={{
          ...data,
          store: { ...publicStore(store), bank: await activeBank(store.id) },
          features: {
            goong: !!process.env.GOONG_API_KEY,
            google:
              !!process.env.GOOGLE_CLIENT_ID &&
              !!process.env.GOOGLE_CLIENT_SECRET,
          },
        }}
      />
    );
  });
}
