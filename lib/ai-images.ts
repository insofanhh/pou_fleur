import { z } from "zod";
import { AI_IMAGE_MAX_BYTES, safeAIImageURL, type AIImage } from "./ai-image-policy";

function validImage(value: string) {
  if (!safeAIImageURL(value)) return false;
  const [head, base64] = value.split(","), bytes = Buffer.from(base64, "base64");
  if (bytes.length < 16 || bytes.length > AI_IMAGE_MAX_BYTES || bytes.toString("base64") !== base64) return false;
  if (head.includes("image/jpeg")) return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (head.includes("image/png")) return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
export const aiImageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dataUrl: z.string().max(Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4 + 40).refine(validImage, "Ảnh không hợp lệ. Chọn JPG, PNG hoặc WebP tối đa 512 KB sau tối ưu."),
}).strict();
export function aiUserContent(text: string, images: AIImage[]) {
  return images.length ? [
    { type: "text" as const, text },
    ...images.map(image => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })),
  ] : text;
}
