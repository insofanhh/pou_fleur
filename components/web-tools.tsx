"use client";
import { useEffect } from "react";
import { flushSync } from "react-dom";
import type { Product } from "@/lib/types";
import { api, useShop } from "./context";
export function WebTools() {
  const { add, cart } = useShop();
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: any) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "find_flowers",
      title: "Tìm hoa tại Fleur",
      description:
        "Tìm thiết kế hoa theo tên, loại hoa và mức giá. Không thay đổi giỏ hàng.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxPrice: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input: unknown) {
        if (!input || typeof input !== "object")
          throw Error("Đầu vào phải là object.");
        const i = input as any;
        if (
          (i.query !== undefined && typeof i.query !== "string") ||
          (i.maxPrice !== undefined &&
            (typeof i.maxPrice !== "number" ||
              !Number.isFinite(i.maxPrice) ||
              i.maxPrice < 0))
        )
          throw Error("Điều kiện tìm kiếm không hợp lệ.");
        const products: Product[] = await api("catalog/products");
        return products
          .filter(
            (p) =>
              (!i.query ||
                (p.name + " " + p.flowers)
                  .toLowerCase()
                  .includes(i.query.toLowerCase())) &&
              (i.maxPrice === undefined || p.price <= i.maxPrice),
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            stock: p.stock,
            url: "/product/" + p.slug,
          }));
      },
    });
    register({
      name: "add_flower_to_cart",
      title: "Thêm hoa vào giỏ",
      description:
        "Thêm một thiết kế hoa và số lượng vào giỏ hàng hiện tại. Chỉ chuẩn bị giỏ, không đặt đơn và không thanh toán.",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "integer", minimum: 1 },
          quantity: { type: "integer", minimum: 1, maximum: 30 },
          size: { type: "string", enum: ["S", "M", "L"] },
        },
        required: ["productId", "quantity", "size"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        if (!input || typeof input !== "object")
          throw Error("Đầu vào không hợp lệ.");
        const i = input as any;
        if (
          !Number.isInteger(i.productId) ||
          !Number.isInteger(i.quantity) ||
          i.quantity < 1 ||
          i.quantity > 30 ||
          !["S", "M", "L"].includes(i.size)
        )
          throw Error("Thiết kế hoặc số lượng không hợp lệ.");
        const products: Product[] = await api("catalog/products");
        const p = products.find((p) => p.id === i.productId);
        const count = cart
          .filter((c) => c.productId === i.productId)
          .reduce((s, c) => s + c.quantity, 0);
        if (!p || count + i.quantity > p.stock || count + i.quantity > 30)
          throw Error("Hoa không đủ tồn kho.");
        flushSync(() => add(i.productId, i.quantity, i.size));
        return {
          added: true,
          product: p.name,
          quantity: i.quantity,
          size: i.size,
          cartQuantity: cart.reduce((s, c) => s + c.quantity, 0) + i.quantity,
        };
      },
    });
    return () => lifecycle.abort();
  }, [cart, add]);
  return null;
}
