"use client";

import { useEffect, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

const preferenceKey = "fleurious.sidebar.collapsed";

export function useDashboardSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(preferenceKey) === "true");
    } catch {}
    const media = matchMedia("(max-width: 700px)");
    const resize = () => {
      setNarrow(media.matches);
      setMobile(false);
    };
    resize();
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!mobile || !narrow) return;
    const sidebar = document.getElementById("dashboard-sidebar");
    // Safari does not focus buttons on pointer clicks. Return to the opener
    // explicitly instead of relying on activeElement before the drawer opens.
    const previous = document.querySelector<HTMLElement>(
      ".admin-topbar .admin-menu",
    );
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar?.querySelector<HTMLButtonElement>(".sidebar-mobile-close")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const items = [
        ...sidebar.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mobile, narrow]);
  function toggleCollapsed() {
    setMotion(true);
    const value = !collapsed;
    setCollapsed(value);
    try {
      localStorage.setItem(preferenceKey, String(value));
    } catch {}
  }
  return { collapsed, mobile, setMobile, narrow, toggleCollapsed, motion };
}

export function SidebarControls({
  state,
}: {
  state: ReturnType<typeof useDashboardSidebar>;
}) {
  return (
    <>
      <button
        type="button"
        className="icon-button sidebar-collapse-toggle"
        aria-label={
          state.collapsed ? "Mở rộng thanh menu" : "Thu gọn thanh menu"
        }
        title={state.collapsed ? "Mở rộng thanh menu" : "Thu gọn thanh menu"}
        aria-expanded={!state.collapsed}
        aria-controls="dashboard-sidebar"
        onClick={state.toggleCollapsed}
      >
        {state.collapsed ? (
          <PanelLeftOpen size={20} />
        ) : (
          <PanelLeftClose size={20} />
        )}
      </button>
      <button
        type="button"
        className="icon-button admin-menu"
        aria-label={state.mobile ? "Đóng menu quản trị" : "Mở menu quản trị"}
        aria-expanded={state.mobile}
        aria-controls="dashboard-sidebar"
        onClick={() => state.setMobile(!state.mobile)}
      >
        <Menu size={20} />
      </button>
    </>
  );
}

export function SidebarMobileClose({ close }: { close: () => void }) {
  return (
    <button
      type="button"
      className="icon-button sidebar-mobile-close"
      aria-label="Đóng menu quản trị"
      onClick={close}
    >
      <X size={19} />
    </button>
  );
}

export function SidebarBackdrop({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  return (
    <button
      type="button"
      className={"sidebar-backdrop" + (open ? " is-open" : "")}
      aria-label="Đóng menu quản trị"
      aria-hidden={!open}
      tabIndex={-1}
      onClick={close}
    />
  );
}
