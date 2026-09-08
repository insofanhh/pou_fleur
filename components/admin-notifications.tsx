"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Package,
  MessageSquare,
  UserPlus,
  X,
  CheckCheck,
} from "lucide-react";
import type { AdminNotification } from "@/lib/notification-types";

const icons = { orders: Package, inquiries: MessageSquare, users: UserPlus };
const interval = 15000;
export default function AdminNotifications({ userId }: { userId: number }) {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<AdminNotification[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const readKeys = useRef(new Set<string>());
  const storageKey = `fleur.notifications.read.${userId}`;

  useEffect(() => {
    const loadRead = () => {
      try {
        const parsed: unknown = JSON.parse(
          localStorage.getItem(storageKey) || "[]",
        );
        readKeys.current = new Set(
          Array.isArray(parsed)
            ? parsed
                .filter((x): x is string => typeof x === "string")
                .slice(-1000)
            : [],
        );
        setRead([...readKeys.current]);
      } catch {
        /* Reading still works when local storage is unavailable. */
      }
    };
    loadRead();
    const sync = (e: StorageEvent) => {
      if (e.key === storageKey) loadRead();
    };
    window.addEventListener("storage", sync);
    let disposed = false,
      busy = false,
      initialized = false,
      stopped = false;
    const seen = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    const toastTimers = new Set<ReturnType<typeof setTimeout>>();
    const controller = new AbortController();
    async function poll() {
      if (disposed || stopped || busy) return;
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(poll, interval);
        return;
      }
      busy = true;
      try {
        const response = await fetch("/api/admin/notifications", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          setItems([]);
          setToasts([]);
          setError("Phiên đăng nhập hoặc quyền truy cập đã thay đổi.");
          return;
        }
        if (!response.ok)
          throw Error("Không thể tải thông báo. Đang thử kết nối lại…");
        const data: { userId: number; items: AdminNotification[] } =
          await response.json();
        if (disposed) return;
        if (data.userId !== userId) {
          stopped = true;
          setItems([]);
          setToasts([]);
          return;
        }
        const fresh = initialized
          ? data.items.filter(
              (item) => !seen.has(item.key) && !readKeys.current.has(item.key),
            )
          : [];
        for (const item of data.items) seen.add(item.key);
        // Existing records populate the bell but never flood the first visit with toasts.
        initialized = true;
        setItems(data.items);
        setError("");
        if (fresh.length) {
          const notices = Object.keys(icons).flatMap((type) => {
            const batch = fresh.filter((item) => item.type === type);
            return batch.length
              ? [
                  {
                    ...batch[0],
                    detail:
                      batch.length > 1
                        ? `${batch.length} thông báo mới. Mở danh sách để xem.`
                        : batch[0].detail,
                  },
                ]
              : [];
          });
          setToasts((current) => [...notices, ...current].slice(0, 3));
          const t = setTimeout(() => {
            setToasts((current) =>
              current.filter(
                (item) => !notices.some((n) => n.key === item.key),
              ),
            );
            toastTimers.delete(t);
          }, 8000);
          toastTimers.add(t);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        busy = false;
        if (!disposed) {
          setLoading(false);
          if (!stopped) timer = setTimeout(poll, interval);
        }
      }
    }
    void poll();
    const resume = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      toastTimers.forEach(clearTimeout);
      window.removeEventListener("storage", sync);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [storageKey, userId]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        bell.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function markRead(keys: string[]) {
    keys.forEach((key) => readKeys.current.add(key));
    const next = [...readKeys.current].slice(-1000);
    readKeys.current = new Set(next);
    setRead(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  }
  const unread = items.filter((item) => !read.includes(item.key)).length;
  return (
    <>
      <div className="admin-notifications" ref={root} data-no-fade-in>
        <button
          ref={bell}
          className="notification-bell icon-button"
          aria-label={`Thông báo${unread ? `, ${unread} chưa đọc` : ""}`}
          aria-expanded={open}
          aria-controls="admin-notification-panel"
          onClick={() => setOpen(!open)}
        >
          <Bell size={20} />
          {unread > 0 && (
            <span className="notification-count" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {open && (
          <div
            id="admin-notification-panel"
            className="notification-panel"
            role="region"
            aria-label="Thông báo cửa hàng"
          >
            <div className="notification-heading">
              <strong>Thông báo</strong>
              <button
                className="icon-button"
                aria-label="Đóng thông báo"
                onClick={() => {
                  setOpen(false);
                  bell.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            </div>
            <div className="notification-toolbar">
              <span>{unread} chưa đọc</span>
              <button
                disabled={!unread}
                onClick={() => markRead(items.map((item) => item.key))}
              >
                <CheckCheck size={15} /> Đọc tất cả
              </button>
            </div>
            {error && (
              <p className="notification-message" role="status">
                {error}
              </p>
            )}
            {loading && (
              <p className="notification-message">Đang tải thông báo…</p>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="notification-message">
                Chưa có thông báo dành cho bạn.
              </p>
            )}
            <div className="notification-list">
              {items.map((item) => {
                const Icon = icons[item.type];
                const unreadItem = !read.includes(item.key);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`notification-item${unreadItem ? " unread" : ""}`}
                    onClick={() => {
                      markRead([item.key]);
                      setOpen(false);
                    }}
                  >
                    <span className="notification-icon">
                      <Icon size={18} />
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                      <time dateTime={new Date(item.createdAt).toISOString()}>
                        {new Date(item.createdAt).toLocaleString("vi-VN")}
                      </time>
                    </span>
                    {unreadItem && <i aria-label="Chưa đọc" />}
                  </Link>
                );
              })}
            </div>
            <p className="notification-footnote">
              30 mục gần nhất mỗi loại · Tự cập nhật mỗi 15 giây
            </p>
          </div>
        )}
      </div>
      <div
        className="admin-notification-toasts"
        aria-live="polite"
        aria-relevant="additions"
        data-no-fade-in
      >
        {toasts.map((item) => {
          const Icon = icons[item.type];
          return (
            <div className="admin-notification-toast" key={item.key}>
              <Icon size={21} />
              <Link
                href={item.href}
                onClick={() => {
                  markRead([item.key]);
                  setToasts((current) =>
                    current.filter((t) => t.key !== item.key),
                  );
                }}
              >
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </Link>
              <button
                className="icon-button"
                aria-label="Đóng thông báo mới"
                onClick={() =>
                  setToasts((current) =>
                    current.filter((t) => t.key !== item.key),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
