"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bot, Maximize2, Minus, MessageCircle } from "lucide-react";
import { useLocalPath } from "./routing";
import Link from "./routing";

// Load the shared chat/actions UI only on the first open. Keep it mounted when
// minimized so in-flight requests, the draft and confirmations survive navigation.
const QuickChat = dynamic(() => import("./workspace-ai"), {
  loading: () => <p className="ai-quick-loading" role="status">Đang mở trợ lý AI…</p>,
});

export default function WorkspaceAIWidget() {
  const path = useLocalPath();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [thread, setThread] = useState("");
  const [unread, setUnread] = useState(false);
  const [working, setWorking] = useState(false);
  const [viewport, setViewport] = useState<CSSProperties>({});
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const fullPage = /^\/admin\/ai(?:\/|$)/.test(path);
  const visible = open && !fullPage;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const notifyReply = useCallback(() => { if (!visibleRef.current) setUnread(true); }, []);

  useEffect(() => {
    if (!visible) return;
    setUnread(false);
    // Focus the shell immediately, even while the lazy chunk is loading.
    panel.current?.focus({ preventScroll: true });
    const measure = () => {
      const v = window.visualViewport;
      if (!v) return;
      setViewport({
        "--ai-visible-height": `${v.height}px`,
        "--ai-keyboard-inset": `${Math.max(0, window.innerHeight - v.height - v.offsetTop)}px`,
      } as CSSProperties);
    };
    measure();
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [visible]);

  function minimize() {
    setOpen(false);
    launcher.current?.focus({ preventScroll: true });
  }

  // The widget is only mounted by the authenticated workspace shell, after auth
  // is ready, and keyed by store/account/role there. Never persist chat in storage.
  return createPortal(<div className="ai-widget" hidden={fullPage}>
    <button ref={launcher} className="ai-launcher" aria-label={open ? "Thu gọn trợ lý AI" : "Mở chat nhanh với trợ lý AI"} aria-expanded={open} aria-controls={panelId}
      onClick={() => { if (open) minimize(); else { setStarted(true); setOpen(true); } }}>
      {open ? <Minus size={23} /> : <MessageCircle size={25} />}<span>Trợ lý AI</span>
      {unread && <span className="ai-unread" role="status" aria-label="Trợ lý AI có phản hồi mới" />}
    </button>
    {started && <section ref={panel} id={panelId} className="ai-quick-panel" role="dialog" aria-label="Chat nhanh với trợ lý AI" tabIndex={-1} hidden={!visible} style={viewport}
      onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); minimize(); } }}>
      <header className="ai-quick-header">
        <div><Bot size={22} /><div><strong>Trợ lý AI</strong><small>Hỗ trợ riêng cho cửa hàng</small></div></div>
        <div><Link href={"/admin/ai" + (thread ? "?conversation=" + encodeURIComponent(thread) : "")} scroll={false} className="ai-quick-control" aria-label="Mở trang Trợ lý AI" aria-disabled={working} tabIndex={working ? -1 : undefined} onClick={e => { if (working) e.preventDefault(); }} title={working ? "Chờ phản hồi hoàn tất để mở rộng" : "Mở trang Trợ lý AI"}><Maximize2 size={18} /></Link>
          <button className="ai-quick-control" onClick={minimize} aria-label="Thu gọn hội thoại" title="Thu gọn hội thoại"><Minus size={20} /></button></div>
      </header>
      <QuickChat compact active={visible} onThreadChange={setThread} onReply={notifyReply} onWorkingChange={setWorking} />
    </section>}
  </div>, document.body);
}
