"use client";
import { useState } from "react";
import { api, useShop } from "./context";
import {
  demoEmailValues,
  emailHTML,
  interpolateEmail,
  emailVariables,
} from "@/lib/email-content";

const statusNames: Record<string, string> = {
  pending: "Chờ gửi",
  sending: "Đang gửi",
  sent: "SMTP đã tiếp nhận",
  failed: "Gửi thất bại",
  uncertain: "Cần kiểm tra SMTP",
  cancelled: "Đã hủy",
};
const segments = [
  ["all", "Tất cả khách đồng ý nhận tin"],
  ["new", "Khách mới"],
  ["loyal", "Khách thân thiết"],
  ["vip", "Khách VIP"],
  ["inactive", "Khách chưa quay lại"],
];
function initialCampaign() {
  return {
    requestKey: crypto.randomUUID(),
    name: "",
    templateId: 0,
    segment: "all",
    customerId: null as number | null,
    birthdayMonth: null as number | null,
    message: "",
    promotionCode: "",
    eventDate: "",
  };
}
export default function EmailWorkspace({
  payload,
  refresh,
  canEdit,
}: {
  payload: any;
  refresh: () => Promise<void>;
  canEdit: boolean;
}) {
  const { toast } = useShop();
  const [tab, setTab] = useState("templates");
  const [selected, setSelected] = useState<any>(null);
  const [campaign, setCampaign] = useState(initialCampaign);
  const [preview, setPreview] = useState<any>(null);
  const [messagePreview, setMessagePreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [logFilter, setLogFilter] = useState("");
  const cfg = payload.configuration;
  const templates = payload.templates || [];
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function updateCampaign(patch: Partial<typeof campaign>) {
    setCampaign({ ...campaign, ...patch });
    setPreview(null);
  }
  const rendered = selected
    ? {
        subject: interpolateEmail(selected.subject, demoEmailValues),
        html: emailHTML(
          interpolateEmail(selected.body, demoEmailValues),
          selected.kind === "marketing"
            ? "https://example.com/unsubscribe"
            : undefined,
        ),
      }
    : null;
  return (
    <div className="email-workspace">
      <section className="email-config">
        <div>
          <strong>
            {cfg.enabled && cfg.ready
              ? "SMTP đã cấu hình"
              : "Email đang tạm dừng"}
          </strong>
          <p>
            {cfg.enabled && cfg.ready
              ? "Người gửi: " + cfg.from
              : "Đơn hàng vẫn được lưu. Email xác nhận chờ trong hàng đợi đến khi SMTP được cấu hình và bật gửi."}
          </p>
          {(!cfg.ready || !cfg.enabled) && (
            <p className="small">
              Cần SMTP_HOST, SMTP_PORT (465/587), SMTP_USER, SMTP_PASSWORD,
              SMTP_FROM_EMAIL, APP_ORIGIN HTTPS và EMAIL_ENABLED=true trong môi
              trường triển khai.
            </p>
          )}
        </div>
        <div className="email-actions">
          {canEdit && (
            <button
              className="button secondary"
              disabled={busy || !cfg.ready}
              onClick={() =>
                void act(async () => {
                  await api("admin/emails/verify", "POST", {});
                  toast("Kết nối và xác thực SMTP thành công. Chưa gửi email.");
                })
              }
            >
              Kiểm tra kết nối
            </button>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void act(refresh)}
          >
            Làm mới
          </button>
        </div>
      </section>
      <div className="email-stats">
        {Object.entries(statusNames).map(([key, label]) => (
          <div key={key}>
            <strong>
              {payload.stats.find((s: any) => s.status === key)?.count || 0}
            </strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="email-tabs" role="tablist" aria-label="Quản lý email">
        {[
          ["templates", "Mẫu email"],
          ["campaigns", "Chương trình CRM"],
          ["history", "Lịch sử gửi"],
        ].map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => {
              setTab(key);
              setMessagePreview(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "templates" && (
        <div className="email-columns">
          <section className="email-panel">
            <h2>Thư từ Fleur</h2>
            <p>Mẫu trắng đen, nội dung cá nhân hóa theo từng khách.</p>
            {canEdit && (
              <button
                className="button secondary"
                onClick={() =>
                  setSelected({
                    name: "Mẫu CRM mới",
                    subject: "Chào {{customer_name}}",
                    body: "Chào {{customer_name}},\n\n{{campaign_message}}\n\nThân mến,\nFleur",
                    active: 1,
                    kind: "marketing",
                  })
                }
              >
                Thêm mẫu CRM
              </button>
            )}
            <div className="email-template-list">
              {templates.map((t: any) => (
                <button
                  className={selected?.id === t.id ? "active" : ""}
                  key={t.id}
                  onClick={() => setSelected({ ...t })}
                >
                  <strong>{t.name}</strong>
                  <small>
                    {t.kind === "transactional"
                      ? "Tự động theo đơn hàng"
                      : "Chương trình CRM"}{" "}
                    · {t.active ? "Đang bật" : "Đã tắt"}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section className="email-panel">
            {!selected ? (
              <div className="email-empty">
                <h2>Một lời nhắn đúng lúc.</h2>
                <p>Chọn mẫu để xem trước{canEdit ? " và chỉnh sửa" : ""}.</p>
              </div>
            ) : (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const result = await api(
                        "admin/emails/templates" +
                          (selected.id ? "/" + selected.id : ""),
                        selected.id ? "PATCH" : "POST",
                        selected,
                      );
                      setSelected({ ...selected, id: result.id });
                      await refresh();
                      toast(
                        "Đã lưu mẫu. Email đã xếp hàng giữ nội dung tại thời điểm tạo.",
                      );
                    });
                  }}
                >
                  <label className="field">
                    Tên mẫu
                    <input
                      required
                      maxLength={160}
                      disabled={!canEdit}
                      value={selected.name}
                      onChange={(e) =>
                        setSelected({ ...selected, name: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Tiêu đề email
                    <input
                      required
                      maxLength={240}
                      disabled={!canEdit}
                      value={selected.subject}
                      onChange={(e) =>
                        setSelected({ ...selected, subject: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Nội dung
                    <textarea
                      required
                      minLength={10}
                      maxLength={15000}
                      rows={13}
                      disabled={!canEdit}
                      value={selected.body}
                      onChange={(e) =>
                        setSelected({ ...selected, body: e.target.value })
                      }
                    />
                  </label>
                  <details>
                    <summary>Biến nội dung có thể sử dụng</summary>
                    <div className="email-variables">
                      {Object.entries(emailVariables)
                        .filter(([k]) =>
                          selected.kind === "marketing"
                            ? [
                                "customer_name",
                                "campaign_name",
                                "campaign_message",
                                "promotion_code",
                                "event_date",
                              ].includes(k)
                            : !k.startsWith("campaign_") &&
                              !["promotion_code", "event_date"].includes(k),
                        )
                        .map(([key, label]) => (
                          <span key={key}>
                            <code>{"{{" + key + "}}"}</code> {label}
                          </span>
                        ))}
                    </div>
                  </details>
                  <p className="small">
                    Nhập nội dung văn bản; xuống dòng được giữ nguyên. Mẫu đơn
                    hàng luôn cần mã đơn. Nội dung HTML được hiển thị như văn
                    bản.
                  </p>
                  <div className="email-actions">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={Boolean(selected.active)}
                        onChange={(e) =>
                          setSelected({
                            ...selected,
                            active: e.target.checked ? 1 : 0,
                          })
                        }
                      />
                      Bật mẫu email
                    </label>
                    {canEdit && (
                      <button className="button" disabled={busy}>
                        Lưu mẫu
                      </button>
                    )}
                  </div>
                </form>
                <h3>Xem trước với dữ liệu minh họa</h3>
                <strong>{rendered?.subject}</strong>
                <iframe
                  title="Xem trước mẫu email"
                  sandbox=""
                  srcDoc={rendered?.html}
                  className="email-preview"
                />
              </>
            )}
          </section>
        </div>
      )}
      {tab === "campaigns" && (
        <>
          <div className="email-columns">
            <section className="email-panel">
              <h2>Gửi một chương trình</h2>
              <p>
                Chọn nhóm khách, cá nhân hóa lời nhắn rồi xem trước người nhận.
                Tối đa 500 khách mỗi chương trình.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    setPreview(
                      await api(
                        "admin/emails/preview-campaign",
                        "POST",
                        campaign,
                      ),
                    );
                  });
                }}
              >
                <label className="field">
                  Tên chương trình
                  <input
                    required
                    maxLength={160}
                    value={campaign.name}
                    onChange={(e) => updateCampaign({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  Mẫu email
                  <select
                    required
                    value={campaign.templateId || ""}
                    onChange={(e) =>
                      updateCampaign({ templateId: Number(e.target.value) })
                    }
                  >
                    <option value="">Chọn mẫu CRM</option>
                    {templates
                      .filter((t: any) => t.kind === "marketing" && t.active)
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  Nhóm khách
                  <select
                    value={campaign.segment}
                    onChange={(e) =>
                      updateCampaign({ segment: e.target.value })
                    }
                  >
                    {segments.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Một khách cụ thể (tùy chọn)
                  <select
                    value={campaign.customerId || ""}
                    onChange={(e) =>
                      updateCampaign({
                        customerId: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">Tất cả khách trong nhóm</option>
                    {payload.customers
                      .filter((c: any) => c.marketing_consent)
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.email}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  Tháng sinh nhật (tùy chọn)
                  <select
                    value={campaign.birthdayMonth || ""}
                    onChange={(e) =>
                      updateCampaign({
                        birthdayMonth: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">Không lọc tháng sinh</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        Tháng {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Lời nhắn chương trình
                  <textarea
                    required
                    maxLength={6000}
                    rows={5}
                    value={campaign.message}
                    onChange={(e) =>
                      updateCampaign({ message: e.target.value })
                    }
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Mã ưu đãi
                    <input
                      maxLength={80}
                      value={campaign.promotionCode}
                      onChange={(e) =>
                        updateCampaign({ promotionCode: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Thời gian sự kiện
                    <input
                      maxLength={120}
                      value={campaign.eventDate}
                      onChange={(e) =>
                        updateCampaign({ eventDate: e.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="small">
                  Mã ưu đãi cần được tạo riêng trong mục Khuyến mãi. Các bộ lọc
                  được áp dụng đồng thời.
                </p>
                <button className="button secondary" disabled={busy}>
                  Xem trước & kiểm tra người nhận
                </button>
              </form>
            </section>
            <section className="email-panel">
              {!preview ? (
                <div className="email-empty">
                  <h2>Gửi đúng người.</h2>
                  <p>
                    Khách chưa đồng ý nhận tin hoặc đã hủy đăng ký sẽ được loại
                    khỏi danh sách.
                  </p>
                </div>
              ) : (
                <>
                  <h2>{preview.count} người nhận</h2>
                  <strong>{preview.subject}</strong>
                  <iframe
                    title="Xem trước chương trình CRM"
                    sandbox=""
                    className="email-preview"
                    srcDoc={preview.html}
                  />
                  <details>
                    <summary>
                      Xem danh sách người nhận ({preview.count})
                    </summary>
                    <ul className="email-recipients">
                      {preview.recipients.map((c: any) => (
                        <li key={c.id}>
                          {c.name} · {c.email}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <p className="small">
                    Mỗi khách nhận một email riêng kèm liên kết hủy đăng ký. Đây
                    là thao tác gửi thực tế.
                  </p>
                  <button
                    className="button"
                    disabled={
                      busy || !preview.count || !cfg.enabled || !cfg.ready
                    }
                    onClick={() =>
                      void act(async () => {
                        const r = await api("admin/emails/campaigns", "POST", {
                          ...campaign,
                          recipientIds: preview.recipients.map(
                            (c: any) => c.id,
                          ),
                          templateVersion: preview.templateVersion,
                          audienceVersion: preview.audienceVersion,
                        });
                        toast(
                          "Đã xếp hàng chương trình #" +
                            r.id +
                            ". Theo dõi kết quả trong Lịch sử gửi.",
                        );
                        setCampaign(initialCampaign());
                        setPreview(null);
                        await refresh();
                      })
                    }
                  >
                    Gửi chương trình đến {preview.count} khách
                  </button>
                </>
              )}
            </section>
          </div>
          <section className="email-panel">
            <h2>Các chương trình gần đây</h2>
            <div className="email-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Chương trình</th>
                    <th>Khách</th>
                    <th>SMTP tiếp nhận</th>
                    <th>Chờ gửi</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payload.campaigns.map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <small>
                          #{c.id} · {c.created_at}
                        </small>
                      </td>
                      <td>{c.recipient_count}</td>
                      <td>{c.sent_count}</td>
                      <td>{c.pending_count}</td>
                      <td>
                        <button
                          className="text-link"
                          disabled={busy || !c.pending_count}
                          onClick={() =>
                            void act(async () => {
                              await api(
                                "admin/emails/cancel-campaign/" + c.id,
                                "POST",
                                {},
                              );
                              await refresh();
                              toast(
                                "Đã hủy các email chưa gửi của chương trình.",
                              );
                            })
                          }
                        >
                          Hủy phần chưa gửi
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === "history" && (
        <section className="email-panel">
          <div className="email-actions">
            <h2>Lịch sử email</h2>
            <select
              aria-label="Lọc kết quả gửi"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(statusNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              disabled={busy || !cfg.enabled || !cfg.ready}
              onClick={() =>
                void act(async () => {
                  const r = await api("admin/emails/process", "POST", {});
                  await refresh();
                  toast(
                    "Đã xử lý " +
                      r.processed +
                      " email. Làm tiếp nếu vẫn còn hàng đợi.",
                  );
                })
              }
            >
              Xử lý hàng đợi
            </button>
          </div>
          <p>
            Hiển thị 200 email gần nhất. “SMTP đã tiếp nhận” chưa xác nhận thư
            đã vào hộp thư đến. Email “Cần kiểm tra SMTP” không tự gửi lại để
            tránh gửi trùng.
          </p>
          <div className="email-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người nhận / tiêu đề</th>
                  <th>Kết quả</th>
                  <th>Số lần</th>
                  <th>Thời gian</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payload.messages
                  .filter((m: any) => !logFilter || m.status === logFilter)
                  .map((m: any) => (
                    <tr key={m.id}>
                      <td>
                        {m.recipient}
                        <small>{m.subject}</small>
                      </td>
                      <td>
                        <span className={"email-status " + m.status}>
                          {statusNames[m.status]}
                        </span>
                        {m.last_error && <small>{m.last_error}</small>}
                      </td>
                      <td>{m.attempts}</td>
                      <td>{m.sent_at || m.created_at}</td>
                      <td>
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() =>
                            void act(async () =>
                              setMessagePreview(
                                await api(
                                  "admin/emails/message/" + m.id,
                                  "POST",
                                  {},
                                ),
                              ),
                            )
                          }
                        >
                          Xem
                        </button>
                        {m.status === "failed" && (
                          <button
                            className="text-link"
                            disabled={busy || !cfg.enabled || !cfg.ready}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  "admin/emails/retry/" + m.id,
                                  "POST",
                                  {},
                                );
                                await refresh();
                                toast("Đã đưa email về hàng đợi.");
                              })
                            }
                          >
                            Thử lại
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!payload.messages.length && (
            <p>Chưa có email nào. Đơn hàng mới sẽ xuất hiện tại đây.</p>
          )}
          {messagePreview && (
            <div>
              <h3>{messagePreview.subject}</h3>
              <iframe
                title="Nội dung email đã xếp hàng"
                sandbox=""
                className="email-preview"
                srcDoc={messagePreview.html}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
