import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_SOURCE_BYTES, AI_IMAGE_MAX_SIDE, type AIImage } from "@/lib/ai-image-policy";

export async function prepareAIImage(file: File): Promise<AIImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > AI_IMAGE_MAX_SOURCE_BYTES) throw new Error("Chọn ảnh JPG, PNG hoặc WebP dưới 8 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, AI_IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt chưa hỗ trợ xử lý ảnh.");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5, 0.35]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if ((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75 <= AI_IMAGE_MAX_BYTES) return { name: file.name.slice(0, 120) || "Ảnh đính kèm", dataUrl };
    }
    throw new Error("Ảnh còn quá lớn sau tối ưu. Hãy cắt bớt ảnh rồi thử lại.");
  } catch (e) {
    throw e instanceof Error && e.message.includes("Ảnh còn") ? e : new Error("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP hợp lệ.");
  } finally { URL.revokeObjectURL(url); }
}
