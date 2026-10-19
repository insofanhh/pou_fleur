import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { tenantId, withStore } from "./tenant";
import { query } from "./db";
import type { Catalog } from "./types";

// This app uses the existing App Router cache model (Cache Components is off).
// Namespace by database so changing the deployment DB cannot reuse old data.
const namespace = [
  "fleur-public-v1",
  process.env.MYSQL_HOST || "local",
  process.env.MYSQL_DATABASE || "fleur_store",
];
const products = cache(
  unstable_cache(
    async (storeId: number) =>
      withStore(storeId, () =>
        query<Catalog["products"]>(
          "SELECT p.*,c.name category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.id",
        ),
      ),
    [...namespace, "products"],
    { tags: ["catalog-products"], revalidate: 60 },
  ),
);
const categories = cache(
  unstable_cache(
    async (storeId: number) =>
      withStore(storeId, () =>
        query<Catalog["categories"]>("SELECT * FROM categories ORDER BY id"),
      ),
    [...namespace, "categories"],
    { tags: ["catalog-categories"], revalidate: 60 },
  ),
);
const posts = cache(
  unstable_cache(
    async (storeId: number, slug: string) =>
      withStore(storeId, () =>
        query<Catalog["posts"]>(
          slug
            ? "SELECT * FROM posts WHERE published=1 AND slug=?"
            : "SELECT id,title,slug,excerpt,image,published,created_at,'' AS content FROM posts WHERE published=1 ORDER BY created_at DESC",
          slug ? [slug] : [],
        ),
      ),
    [...namespace, "posts"],
    { tags: ["catalog-posts"], revalidate: 60 },
  ),
);
const events = cache(
  unstable_cache(
    async (storeId: number) =>
      withStore(storeId, () =>
        query<Catalog["events"]>(
          "SELECT * FROM events WHERE active=1 ORDER BY starts_at",
        ),
      ),
    [...namespace, "events"],
    { tags: ["catalog-events"], revalidate: 60 },
  ),
);

export const publicProducts = () => products(tenantId());
const catalogCached = cache(
  async (storeId: number, area: string, slug = ""): Promise<Catalog> => {
    const needProducts = [
      "",
      "shop",
      "product",
      "cart",
      "checkout",
      "wishlist",
    ].includes(area);
    const needCategories = ["", "shop", "admin"].includes(area);
    const [p, c, j, e] = await Promise.all([
      needProducts ? products(storeId) : [],
      needCategories ? categories(storeId) : [],
      area === "journal" ? posts(storeId, slug) : [],
      area === "events" ? events(storeId) : [],
    ]);
    return { products: p, categories: c, posts: j, events: e };
  },
);

export const catalogForRoute = (area: string, slug = "") =>
  catalogCached(tenantId(), area, slug);

export function invalidateCatalog(area: string) {
  if (["products", "categories", "posts", "events"].includes(area))
    revalidateTag("catalog-" + area, { expire: 0 });
  // Product rows include category names; orders can reserve or restore stock.
  if (["categories", "flower_components", "orders", "checkout"].includes(area))
    revalidateTag("catalog-products", { expire: 0 });
}
