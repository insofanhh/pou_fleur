// Small inline images stay private to the authenticated conversation; no public
// product upload URLs are created. Keep the body well below hosting limits.
export const AI_IMAGE_MAX_BYTES = 512 * 1024;
export const AI_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const AI_IMAGE_MAX_SIDE = 1280;
export type AIImage = { name: string; dataUrl: string };
export function supportsAIImages(model: string) { return model === "deepseek-flash"; }
export function safeAIImageURL(value: unknown): value is string {
  return typeof value === "string" && value.length <= Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4 + 40 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
