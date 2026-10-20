"use client";
import { formatDateTime } from "@/lib/date-time";
import Select from "./ui-select";
import {
  Eye,
  RotateCcw,
  Ban,
  MailCheck,
  MailWarning,
  Plus,
  PlugZap,
} from "lucide-react";
import { TableAction, TableActions } from "./table-actions";
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
  platform = false,
  storeName,
}: {
  payload: any;
  refresh: () => Promise<void>;
  canEdit: boolean;
  platform?: boolean;
  storeName?: string;
}) {
  const { toast } = useShop();
  const base = platform ? "platform/emails" : "admin/emails";
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
  function addTemplate() {
    setSelected({
      name: "Mẫu CRM mới",
      subject: "Chào {{customer_name}}",
      body: "Chào {{customer_name}},\n\n{{campaign_message}}\n\nThân mến,\nFleurious",
      active: 1,
      kind: "marketing",
    });
  }
  const previewValues = {
    ...demoEmailValues,
    ...(!platform && storeName ? { store_name: storeName } : {}),
  };
  const rendered = selected
    ? {
        subject: interpolateEmail(selected.subject, previewValues),
        html: emailHTML(
          interpolateEmail(selected.body, previewValues),
          selected.kind === "marketing"
            ? "https://example.com/unsubscribe"
            : undefined,
          platform ? "Fleurious Platform" : "Fleurious",
          platform ? undefined : storeName,
        ),
      }
    : null;
  return (
    <div
      className={
        "email-workspace" + (platform ? " platform-email-workspace" : "")
      }
    >
      <section className="email-config">
        {platform && (
          <span
            className={
              "email-connection-icon " +
              (cfg.enabled && cfg.ready ? "ready" : "paused")
            }
            aria-hidden="true"
          >
            {cfg.enabled && cfg.ready ? (
              <MailCheck size={20} />
            ) : (
              <MailWarning size={20} />
            )}
          </span>
        )}
        <div>
          <strong>
            {cfg.enabled && cfg.ready
              ? "Email hệ thống đã sẵn sàng"
              : "Email đang tạm dừng"}
          </strong>
          <p>
            {cfg.enabled && cfg.ready
              ? platform
                ? "Email tài khoản, cửa hàng và gói dịch vụ được quản lý tập trung. Không trừ hạn mức email của store."
                : "Gửi bằng email hệ thống, hiển thị tên cửa hàng của bạn."
              : platform
                ? "Thông báo hệ thống được lưu trong hàng đợi đến khi SMTP sẵn sàng và bật gửi."
                : "Đơn hàng vẫn được lưu. Email xác nhận chờ trong hàng đợi đến khi SMTP được cấu hình và bật gửi."}
          </p>
          {(!cfg.ready || !cfg.enabled) && (
            <p className="small">
              Quản trị nền tảng quản lý cấu hình gửi thư chung. Liên hệ hỗ trợ
              nếu email chưa được bật.
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
                  await api(base + "/verify", "POST", {});
                  toast("Kết nối và xác thực SMTP thành công. Chưa gửi email.");
                })
              }
            >
              {platform && <PlugZap size={15} aria-hidden="true" />}
              Kiểm tra kết nối
            </button>
          )}
          {!platform && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void act(refresh)}
            >
              Làm mới
            </button>
          )}
        </div>
      </section>
      <div className="email-stats">
        {Object.entries(statusNames).map(([key, label]) => (
          <div key={key} className={platform ? "stat-card" : undefined}>
            {platform && <span>{label}</span>}
            <strong>
              {payload.stats.find((s: any) => s.status === key)?.count || 0}
            </strong>
            {!platform && <span>{label}</span>}
          </div>
        ))}
      </div>
      <div className="email-tabs" role="tablist" aria-label="Quản lý email">
        {[
          ["templates", "Mẫu email"],
          [
            "campaigns",
            platform ? "Chương trình nền tảng" : "Chương trình CRM",
          ],
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
            <div className="email-panel-heading">
              <h2>{platform ? "Email hệ thống" : "Thư từ cửa hàng"}</h2>
              {platform && canEdit && (
                <button className="button secondary" onClick={addTemplate}>
                  <Plus size={15} aria-hidden="true" />
                  Thêm mẫu CRM
                </button>
              )}
            </div>
            <p>
              {platform
                ? "Mẫu tài khoản, cửa hàng và thuê bao. Email đã xếp hàng giữ nội dung tại thời điểm tạo."
                : "Sáu mẫu đơn hàng và chăm sóc có thể tùy chỉnh riêng; gửi bằng email hệ thống với tên cửa hàng."}
            </p>
            {!platform && canEdit && (
              <button className="button secondary" onClick={addTemplate}>
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
                      ? platform
                        ? "Tự động theo sự kiện hệ thống"
                        : "Tự động theo đơn hàng"
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
                {platform && <MailCheck size={28} aria-hidden="true" />}
                <h2>
                  {platform ? "Chọn mẫu email" : "Một lời nhắn đúng lúc."}
                </h2>
                <p>Chọn mẫu để xem trước{canEdit ? " và chỉnh sửa" : ""}.</p>
              </div>
            ) : (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const result = await api(
                        base +
                          "/templates" +
                          (selected.id ? "/" + selected.id : ""),
                        selected.id ? "PATCH" : "POST",
                        selected,
                      );
                      setSelected({
                        ...selected,
                        id: result.id,
                        version: result.version,
                      });
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
                                "store_name",
                                "store_url",
                                "campaign_name",
                                "campaign_message",
                                "promotion_code",
                                "event_date",
                              ].includes(k)
                            : platform
                              ? selected.variables?.includes(k)
                              : [
                                  "customer_name",
                                  "store_name",
                                  "store_url",
                                  "order_reference",
                                  "order_items",
                                  "order_total",
                                  "payment_method",
                                  "order_status",
                                  "previous_status",
                                  "recipient_name",
                                  "delivery_address",
                                  "delivery_date",
                                  "delivery_slot",
                                  "tracking_url",
                                ].includes(k),
                        )
                        .map(([key, label]) => (
                          <span key={key}>
                            <code>{"{{" + key + "}}"}</code> {label}
                          </span>
                        ))}
                    </div>
                  </details>
                  <p className="small">
                    Nhập nội dung văn bản; xuống dòng được giữ nguyên. Giữ các
                    biến nghiệp vụ bắt buộc. Mẫu đơn hàng luôn cần mã đơn. Nội
                    dung HTML được hiển thị như văn bản.
                  </p>
                  <div className="email-actions">
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={
                          !canEdit ||
                          (platform && selected.kind === "transactional")
                        }
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
                      await api(base + "/preview-campaign", "POST", campaign),
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
                  <Select
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
                  </Select>
                </label>
                <label className="field">
                  Nhóm khách
                  <Select
                    value={campaign.segment}
                    onChange={(e) =>
                      updateCampaign({ segment: e.target.value })
                    }
                  >
                    {(payload.audienceSegments || segments).map(
                      ([v, l]: string[]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ),
                    )}
                  </Select>
                </label>
                <label className="field">
                  Một khách cụ thể (tùy chọn)
                  <Select
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
                  </Select>
                </label>
                <label className="field">
                  Tháng sinh nhật (tùy chọn)
                  <Select
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
                  </Select>
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
                  Mã ưu đãi cần được thiết lập riêng trước khi gửi. Các bộ lọc
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
                        const r = await api(base + "/campaigns", "POST", {
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
                    <th className="table-actions-heading" scope="col">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.campaigns.map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <small>
                          #{c.id} · {formatDateTime(c.created_at)}
                        </small>
                      </td>
                      <td>{c.recipient_count}</td>
                      <td>{c.sent_count}</td>
                      <td>{c.pending_count}</td>
                      <td>
                        <TableActions>
                          <TableAction
                            icon={Ban}
                            disabled={busy || !c.pending_count}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  base + "/cancel-campaign/" + c.id,
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
                          </TableAction>
                        </TableActions>
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
            <Select
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
            </Select>
            <button
              className="button secondary"
              disabled={busy || !cfg.enabled || !cfg.ready}
              onClick={() =>
                void act(async () => {
                  const r = await api(base + "/process", "POST", {});
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
                  <th className="table-actions-heading" scope="col">
                    Thao tác
                  </th>
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
                        {platform && (
                          <small>
                            {m.id.startsWith("store-")
                              ? "Cửa hàng / gói dịch vụ"
                              : "Tài khoản / chương trình platform"}
                          </small>
                        )}
                      </td>
                      <td>
                        <span className={"email-status " + m.status}>
                          {statusNames[m.status]}
                        </span>
                        {m.last_error && (
                          <small>
                            {m.last_error === "EMAIL_MONTHLY_LIMIT"
                              ? "Đã đạt hạn mức email tháng này. Thư sẽ được gửi khi có hạn mức."
                              : m.last_error}
                          </small>
                        )}
                      </td>
                      <td>{m.attempts}</td>
                      <td>{formatDateTime(m.sent_at || m.created_at)}</td>
                      <td>
                        <TableActions>
                          <TableAction
                            icon={Eye}
                            disabled={busy}
                            onClick={() =>
                              void act(async () =>
                                setMessagePreview(
                                  await api(
                                    base + "/message/" + m.id,
                                    "POST",
                                    {},
                                  ),
                                ),
                              )
                            }
                          >
                            Xem
                          </TableAction>
                          {m.status === "failed" && (
                            <TableAction
                              icon={RotateCcw}
                              disabled={busy || !cfg.enabled || !cfg.ready}
                              onClick={() =>
                                void act(async () => {
                                  await api(
                                    base + "/retry/" + m.id,
                                    "POST",
                                    {},
                                  );
                                  await refresh();
                                  toast("Đã đưa email về hàng đợi.");
                                })
                              }
                            >
                              Thử lại
                            </TableAction>
                          )}
                        </TableActions>
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
