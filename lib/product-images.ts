export const MAX_PRODUCT_IMAGES = 12;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function parseGallery(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((v): v is string => typeof v === "string" && !!v.trim()),
        ),
      ].slice(0, MAX_PRODUCT_IMAGES - 1)
    : [];
}
export function productImages(product: { image: string; gallery?: unknown }) {
  return [
    ...new Set(
      [product.image, ...parseGallery(product.gallery)].filter(Boolean),
    ),
  ];
}
export function productSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180)
    .replace(/-+$/g, "");
}

export function imageSwipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= 45 || Math.abs(dx) <= Math.abs(dy) * 1.3) return 0;
  return dx < 0 ? 1 : -1;
}
