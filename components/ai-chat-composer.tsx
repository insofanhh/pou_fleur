"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ImagePlus, ListFilter, LoaderCircle, Send, X } from "lucide-react";
import { prepareAIImage } from "./ai-image-input";
import type { AIImage } from "@/lib/ai-image-policy";

export const aiSuggestions = [
  ["Đơn cần chú ý", "Những đơn nào đang cần chú ý?"],
  ["Báo cáo 7 ngày", "Báo cáo hoạt động trong 7 ngày gần nhất"],
  ["Lên đơn mới", "Hỗ trợ tôi lên một đơn mới"],
  ["Chăm sóc khách hàng", "Tìm khách hàng cần chăm sóc"],
  ["Lịch giao hôm nay", "Cho tôi xem lịch giao hoa hôm nay"],
  ["Tạo ghi chú", "Hỗ trợ tôi tạo một ghi chú cho hôm nay"],
];

export default function AIChatComposer({ text, setText, image, setImage, inputRef, disabled, imageEnabled, busy, send, onFocus, onReading, onError }: {
  text: string; setText: (text: string) => void; image: AIImage | null; setImage: (image: AIImage | null) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>; disabled: boolean; imageEnabled: boolean; busy: boolean;
  send: () => void; onFocus: () => void; onReading: (reading: boolean) => void; onError: (error: string) => void;
}) {
  const id = useId(), samplesId = useId(), file = useRef<HTMLInputElement>(null), root = useRef<HTMLFormElement>(null);
  const [samples, setSamples] = useState(false), [reading, setReading] = useState(false);
  useEffect(() => {
    const input = inputRef.current;
    if (input) { input.style.height = "0px"; input.style.height = Math.min(104, Math.max(40, input.scrollHeight)) + "px"; }
  }, [text, inputRef]);
  useEffect(() => {
    if (!samples) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setSamples(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [samples]);
  async function selectImage(selected?: File) {
    if (!selected || disabled || reading) return;
    setReading(true); onReading(true); onError(""); setSamples(false);
    try { setImage(await prepareAIImage(selected)); inputRef.current?.focus({ preventScroll: true }); }
    catch (e) { onError((e as Error).message); }
    finally { setReading(false); onReading(false); }
  }
  return <form ref={root} className="ai-compose" onSubmit={e => { e.preventDefault(); if (!disabled && !reading) send(); }} onKeyDown={e => {
    if (e.key === "Escape" && samples) { e.preventDefault(); e.stopPropagation(); setSamples(false); root.current?.querySelector<HTMLButtonElement>(".ai-samples-toggle")?.focus(); }
  }}>
    {samples && <div id={samplesId} className="ai-compose-samples" role="region" aria-label="Câu hỏi mẫu">
      <div><strong>Bạn muốn AI hỗ trợ gì?</strong><button type="button" aria-label="Đóng câu hỏi mẫu" onClick={() => setSamples(false)}><X size={16} /></button></div>
      {aiSuggestions.map(([label, prompt]) => <button type="button" key={label} disabled={disabled} onClick={() => { setText(prompt); setSamples(false); inputRef.current?.focus({ preventScroll: true }); }}>{label}<span>{prompt}</span></button>)}
    </div>}
    {image && <div className="ai-compose-preview"><img src={image.dataUrl} alt="Ảnh chuẩn bị gửi" /><span>{image.name}</span><button type="button" aria-label="Xóa ảnh đính kèm" disabled={disabled || reading} onClick={() => setImage(null)}><X size={16} /></button></div>}
    <div className="ai-compose-row">
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Chọn ảnh cho trợ lý" hidden disabled={disabled || reading || !imageEnabled} onChange={e => { const selected = e.target.files?.[0]; e.target.value = ""; void selectImage(selected); }} />
      <button className="ai-compose-icon" type="button" aria-label="Tải ảnh lên" title={imageEnabled ? "Đính kèm ảnh · JPG, PNG, WebP dưới 8 MB" : "Admin platform cần chọn DeepSeek Flash để đọc ảnh"} disabled={disabled || reading || !imageEnabled} onClick={() => file.current?.click()}>{reading ? <LoaderCircle size={19} className="spin" /> : <ImagePlus size={20} />}</button>
      <button className="ai-compose-icon ai-samples-toggle" type="button" aria-label="Mở câu hỏi mẫu" title="Câu hỏi mẫu" aria-expanded={samples} aria-controls={samplesId} disabled={disabled || reading} onClick={() => setSamples(v => !v)}><ListFilter size={20} /></button>
      <label className="sr-only" htmlFor={id}>Yêu cầu trợ lý</label>
      <textarea id={id} ref={inputRef} rows={1} maxLength={4000} value={text} placeholder="Hỏi trợ lý AI…" disabled={disabled || reading} onFocus={() => { setSamples(false); onFocus(); }} onChange={e => setText(e.target.value)} onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!disabled && !reading) send(); }
      }} />
      <button className="ai-compose-icon ai-compose-send" type="submit" aria-label="Gửi yêu cầu" title="Gửi yêu cầu" disabled={disabled || reading || (!text.trim() && !image)}>{busy ? <LoaderCircle size={19} className="spin" /> : <Send size={20} />}</button>
    </div>
    <small>{reading ? "Đang tối ưu ảnh…" : "AI có thể nhầm. Kiểm tra trước khi xác nhận; không gửi thông tin bí mật."}</small>
  </form>;
}
