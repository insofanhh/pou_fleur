"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type { CartItem, User } from "@/lib/types";
import { X, Check } from "lucide-react";
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Có lỗi xảy ra. Vui lòng thử lại.");
  return data;
}
type State = {
  cart: CartItem[];
  setCart: (items: CartItem[]) => void;
  add: (id: number, quantity?: number, size?: string) => void;
  wishlist: number[];
  toggleWish: (id: number) => void;
  user: User | null;
  setUser: (u: User | null) => void;
  ready: boolean;
  toast: (s: string) => void;
};
const Context = createContext<State>(null!);
export const useShop = () => useContext(Context);
export function Provider({ children }: { children: ReactNode }) {
  const [cart, updateCart] = useState<CartItem[]>([]),
    [wishlist, setWish] = useState<number[]>([]),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem("fleur.cart") || "[]");
      if (Array.isArray(c))
        updateCart(
          c.filter(
            (i) =>
              Number.isInteger(i.productId) &&
              Number.isInteger(i.quantity) &&
              i.quantity > 0 &&
              i.quantity <= 30 &&
              ["S", "M", "L"].includes(i.size),
          ),
        );
      const w = JSON.parse(localStorage.getItem("fleur.wishlist") || "[]");
      if (Array.isArray(w)) setWish(w.filter(Number.isInteger));
    } catch {}
    api("auth/me")
      .then((d) => setUser(d.user))
      .finally(() => setReady(true))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const setCart = useCallback((items: CartItem[]) => {
    updateCart(items);
    localStorage.setItem("fleur.cart", JSON.stringify(items));
  }, []);
  const add = useCallback(
    (id: number, quantity = 1, size = "S") => {
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 30 ||
        !["S", "M", "L"].includes(size)
      )
        throw Error("Số lượng không hợp lệ.");
      const exists = cart.find((i) => i.productId === id && i.size === size);
      if (exists && exists.quantity + quantity > 30) {
        setMessage("Tối đa 30 sản phẩm mỗi lựa chọn.");
        return;
      }
      setCart(
        exists
          ? cart.map((i) =>
              i === exists ? { ...i, quantity: i.quantity + quantity } : i,
            )
          : [...cart, { productId: id, quantity, size }],
      );
      setMessage("Đã thêm hoa vào giỏ hàng.");
    },
    [cart, setCart],
  );
  const toggleWish = (id: number) => {
    const next = wishlist.includes(id)
      ? wishlist.filter((x) => x !== id)
      : [...wishlist, id];
    setWish(next);
    localStorage.setItem("fleur.wishlist", JSON.stringify(next));
    setMessage(
      next.includes(id)
        ? "Đã lưu vào hoa yêu thích."
        : "Đã bỏ khỏi hoa yêu thích.",
    );
  };
  return (
    <Context.Provider
      value={{
        cart,
        setCart,
        add,
        wishlist,
        toggleWish,
        user,
        setUser,
        ready,
        toast: setMessage,
      }}
    >
      {children}
      {message && (
        <div className="toast" role="status">
          <Check size={18} />
          {message}
          <button
            aria-label="Đóng thông báo"
            className="icon-button"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
