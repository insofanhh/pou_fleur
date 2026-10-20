"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { storeRef } from "./routing";
import { isGlobalAPI } from "@/lib/global-routes";
import type { CartItem, User } from "@/lib/types";
import { X, Check } from "lucide-react";
export function track(name: string) {
  if (typeof crypto !== "undefined")
    void api("analytics", "POST", {
      event_key: crypto.randomUUID(),
      name,
    }).catch(() => {});
}
export async function api(path: string, method = "GET", body?: unknown) {
  const pathname = typeof location === "undefined" ? "" : location.pathname;
  const needsStore = !isGlobalAPI(path.split("?", 1)[0].split("/"), method) ||
    /^\/(s|workspace)\//.test(pathname);
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(needsStore ? { "x-fleur-store": storeRef(pathname) } : {}),
    },
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
  const pathname = usePathname(),
    scope = storeRef(pathname);
  const storageKey = "fleur.cart." + scope;
  const [cart, updateCart] = useState<CartItem[]>([]),
    [wishlist, setWish] = useState<number[]>([]),
    [user, setUser] = useState<User | null>(null),
    [ghost, setGhost] = useState<any>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  const activitySent=useRef(0);
  useEffect(()=>{
    if(!ready||!user||ghost) return;
    const workspace=pathname.match(/^\/workspace\/(\d+)(?:\/|$)/);
    const store=workspace?user.memberships?.find(m=>Number(m.store_id)===Number(workspace[1])):pathname.startsWith('/admin')?user.memberships?.find(m=>m.slug==='fleur'):null;
    const send=(force=false)=>{
      if(document.visibilityState!=='visible'||(!force&&Date.now()-activitySent.current<60000)) return;
      activitySent.current=Date.now();
      void api('activity','POST',store?{store_id:Number(store.store_id)}:{}).catch(()=>{});
    };
    send(true);
    const interact=()=>send();
    window.addEventListener('pointerdown',interact,{passive:true});
    window.addEventListener('keydown',interact);
    return ()=>{window.removeEventListener('pointerdown',interact);window.removeEventListener('keydown',interact);};
  },[pathname,ready,user?.id,!!ghost]);
  useEffect(() => {
    let active = true;
    setReady(false);
    updateCart([]);
    setWish([]);
    try {
      const c = JSON.parse(
        localStorage.getItem(storageKey) ||
          (scope === "1" || scope === "fleur"
            ? localStorage.getItem("fleur.cart")
            : null) ||
          "[]",
      );
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
      const w = JSON.parse(
        localStorage.getItem("fleur.wishlist." + scope) || "[]",
      );
      if (Array.isArray(w)) setWish(w.filter(Number.isInteger));
    } catch {}
    api("auth/me")
      .then((d) => {
        if (active) {
          setUser(d.user);
          setGhost(d.ghost || null);
        }
      })
      .finally(() => {
        if (active) setReady(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [scope]);
  useEffect(() => {
    let active = true;
    const refreshIdentity = () => {
      if (document.visibilityState !== "visible") return;
      api("auth/me")
        .then((d) => {
          if (active) {
            setUser(d.user);
            setGhost(d.ghost || null);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refreshIdentity);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshIdentity);
    };
  }, []);
  useEffect(() => {
    if (!ghost) return;
    const timer = setInterval(() => {
      api("auth/me")
        .then((d) => {
          setUser(d.user);
          setGhost(d.ghost || null);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [!!ghost]);
  useEffect(() => {
    if (!pathname.startsWith("/s/")) return;
    const tail = pathname.replace(/^\/s\/[^/]+/, "");
    if (!tail) track("store_view");
    if (tail.startsWith("/product/")) track("product_view");
    if (tail === "/checkout") track("checkout_start");
  }, [pathname]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const setCart = useCallback(
    (items: CartItem[]) => {
      updateCart(items);
      localStorage.setItem(storageKey, JSON.stringify(items));
    },
    [storageKey],
  );
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
      track("add_to_cart");
      setMessage("Đã thêm hoa vào giỏ hàng.");
    },
    [cart, setCart],
  );
  const toggleWish = (id: number) => {
    const next = wishlist.includes(id)
      ? wishlist.filter((x) => x !== id)
      : [...wishlist, id];
    setWish(next);
    localStorage.setItem("fleur.wishlist." + scope, JSON.stringify(next));
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
      {ghost && <GhostBanner ghost={ghost} />}
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

function GhostBanner({ ghost }: { ghost: any }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function stop() {
    setBusy(true);
    setError("");
    try {
      const result = await api("auth/ghost/stop", "POST", {});
      window.location.assign(result.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <aside
      className="ghost-banner"
      aria-label="Phiên hỗ trợ Ghost"
      data-no-fade-in
    >
      <div>
        <strong>
          {ghost.valid
            ? `Đang Ghost: ${ghost.targetName}`
            : "Phiên Ghost đã hết hạn hoặc bị thu hồi"}
        </strong>
        <p>
          {ghost.valid
            ? "Bạn đang thao tác với quyền của tài khoản này. Phiên hỗ trợ tối đa 20 phút."
            : "Quay lại tài khoản admin để tiếp tục."}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        className="button light"
        onClick={() => void stop()}
        disabled={busy}
      >
        {busy ? "Đang quay lại…" : "Quay lại admin"}
      </button>
    </aside>
  );
}
