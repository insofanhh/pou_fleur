import { HttpError } from "./auth";

// Used inside the same store-scoped transaction as product/taxonomy writes.
export async function flowerComposition(
  query: <T = any>(sql: string, values?: any[]) => Promise<T>,
  ids: number[],
  other: string,
) {
  const components: { id: number; name: string }[] = ids.length
    ? await query(
        "SELECT id,name FROM flower_components WHERE id IN (" +
          ids.map(() => "?").join(",") +
          ") ORDER BY id FOR UPDATE",
        ids,
      )
    : [];
  if (components.length !== ids.length)
    throw new HttpError(
      400,
      "Thành phần hoa không tồn tại hoặc không thuộc cửa hàng.",
    );
  const text = [...components.map((c) => c.name), other.trim()]
    .filter(Boolean)
    .join(", ");
  if (!text)
    throw new HttpError(
      400,
      "Vui lòng chọn ít nhất một thành phần hoa hoặc nhập thành phần khác.",
    );
  if (text.length > 255)
    throw new HttpError(400, "Tổng nội dung thành phần hoa tối đa 255 ký tự.");
  return text;
}
