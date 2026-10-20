"use client";

import { useEffect, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import Link from "./routing";
import { api } from "./context";

const groups = [
  { id: "daily", label: "Vận hành hằng ngày", keys: ["overview", "analytics", "board", "calendar", "orders", "crm", "ai", "inquiries"] },
  { id: "catalog", label: "Sản phẩm", keys: ["products", "categories"] },
  { id: "marketing", label: "Tiếp thị & nội dung", keys: ["promotions", "emails", "automations", "events", "posts"] },
  { id: "management", label: "Quản trị cửa hàng", keys: ["theme", "users", "settings", "billing", "audit"] },
];
const preferenceKey = "fleurious.workspace.menu-groups.v1";

export type BillingNavigationNotice = { pending_invoices: number; days_remaining: number | null };

export function billingNoticeText(notice: BillingNavigationNotice | null) {
  if (!notice) return "";
  const parts = [];
  if (notice.pending_invoices > 0) parts.push(`Có ${notice.pending_invoices} hóa đơn dịch vụ chờ thanh toán.`);
  if (notice.days_remaining !== null) parts.push(notice.days_remaining > 0 ? `Gói hiện tại còn ${notice.days_remaining} ngày sử dụng.` : "Gói hiện tại đã hết hạn sử dụng.");
  return parts.join(" ");
}

export function useBillingNavigationNotice(identity: string, enabled: boolean, area: string) {
  const [snapshot, setSnapshot] = useState<{ identity: string; notice: BillingNavigationNotice } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Read-only summary: opening the menu never advances billing or creates invoices.
    void api("workspace/navigation-summary").then(data => {
      if (active) setSnapshot({ identity, notice: data.billing });
    }).catch(() => {});
    return () => { active = false; };
  }, [identity, enabled, area]);
  return enabled && snapshot?.identity === identity ? snapshot.notice : null;
}

export default function WorkspaceNavigation({ items, allowed, area, compact, closeMobile, pendingOrders, billingNotice }: {
  items: readonly (readonly [string, string, LucideIcon])[];
  allowed: string[];
  area: string;
  compact: boolean;
  closeMobile: () => void;
  pendingOrders: number;
  billingNotice: BillingNavigationNotice | null;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let saved: Record<string, boolean> = {};
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        saved = Object.fromEntries(groups.filter(group => value[group.id] === true).map(group => [group.id, true]));
      }
    } catch {}
    const current = groups.find(group => group.keys.includes(area === "new-order" ? "orders" : area));
    if (current) saved[current.id] = false;
    setClosed(saved);
  }, [area]);

  function toggle(id: string) {
    const next = { ...closed, [id]: !closed[id] };
    setClosed(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch {}
  }
  const billingText = billingNoticeText(billingNotice);
  return <nav className="workspace-navigation" aria-label="Điều hướng workspace">
    {groups.map(group => {
      const visible = group.keys.flatMap(key => {
        const item = items.find(item => item[0] === key);
        return item && allowed.includes(key) ? [item] : [];
      });
      if (!visible.length) return null;
      const expanded = compact || group.id === "daily" || !closed[group.id];
      return <section key={group.id} className="workspace-nav-group" aria-label={group.label}>
        <h2 className="workspace-nav-group-title">{group.id === "daily" ? <span>{group.label}</span> : <button type="button" aria-expanded={expanded} aria-controls={"workspace-nav-" + group.id} onClick={() => toggle(group.id)}><span>{group.label}</span><ChevronDown size={14} aria-hidden="true" /></button>}</h2>
        <div id={"workspace-nav-" + group.id} className="workspace-nav-group-items" hidden={!expanded}>
          {visible.map(([key, label, Icon]) => <Link key={key} href={"/admin/" + key} scroll={false} prefetch={true} aria-current={area === key ? "page" : undefined} aria-label={label} title={compact ? label + (key === "billing" && billingText ? ": " + billingText : "") : undefined} onClick={closeMobile} className={area === key ? "active" : ""}>
            <Icon size={18} /><span className="sidebar-nav-label">{label}</span>
            {key === "orders" && pendingOrders > 0 && <span className="nav-badge">{pendingOrders}</span>}
            {key === "billing" && billingText && <span className="nav-badge workspace-billing-badge" aria-label={billingText} title={billingText}>{billingNotice!.pending_invoices > 0 ? billingNotice!.pending_invoices : "!"}</span>}
          </Link>)}
        </div>
      </section>;
    })}
  </nav>;
}
