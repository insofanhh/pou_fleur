"use client";
import { formatDateTime, parseDateTime } from "@/lib/date-time";

import { useRef, useState } from "react";
import { Ban, Check, UserPlus } from "lucide-react";
import { api, useShop } from "./context";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import { displayLabel } from "@/lib/display-labels";

type Member = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
};
type Invitation = {
  id: number;
  email: string;
  role: string;
  status: string;
  expires_at: string;
};
const roles = ["admin", "manager", "editor", "support"];

export default function StoreTeam({
  data,
  error,
  refresh,
}: {
  data: { members: Member[]; invitations: Invitation[] };
  error?: string;
  refresh: () => Promise<unknown>;
}) {
  const { user, toast } = useShop();
  const [busy, setBusy] = useState<number | "invite" | null>(null);
  const locked = useRef(false);
  const [invite, setInvite] = useState("");
  const owner = user?.role === "owner";
  const active = data.members.filter((m) => m.status === "active").length;

  async function update(
    member: Member,
    change: { role: string; status: string },
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(member.id);
    try {
      await api("workspace/team/" + member.id, "PATCH", change);
      await refresh();
      toast("Đã cập nhật nhân sự.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="store-team-page">
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <section
        className="admin-table-panel store-team-members"
        aria-labelledby="store-team-heading"
      >
        <div className="store-team-heading">
          <div>
            <h3 id="store-team-heading">Nhân sự cửa hàng</h3>
            <p>Quản lý vai trò và quyền truy cập tại cửa hàng này.</p>
          </div>
          <span className="store-team-count">
            {data.members.length} nhân sự · {active} đang hoạt động
          </span>
        </div>
        {data.members.length ? (
          <table className="store-team-table">
            <thead>
              <tr>
                <th>Nhân sự</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th className="table-actions-heading">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const editable = owner && m.role !== "owner";
                return (
                  <tr key={m.id} aria-busy={busy === m.id}>
                    <td className="store-team-person">
                      <div className="store-team-identity">
                        <span className="store-team-avatar" aria-hidden="true">
                          {(m.name || m.email)
                            .trim()
                            .split(/\s+/)
                            .slice(-2)
                            .map((s) => s[0])
                            .join("")
                            .toUpperCase()}
                        </span>
                        <div>
                          <strong>{m.name}</strong>
                          <span>{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Vai trò">
                      {editable ? (
                        <Select
                          aria-label={"Vai trò của " + m.name}
                          value={m.role}
                          disabled={busy !== null}
                          onChange={(e) =>
                            void update(m, {
                              role: e.target.value,
                              status: m.status,
                            })
                          }
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {displayLabel("role", r)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="store-team-role">
                          {displayLabel("role", m.role)}
                        </span>
                      )}
                    </td>
                    <td data-label="Trạng thái">
                      <span
                        className={
                          "store-team-status " +
                          (m.status === "active" ? "is-active" : "is-muted")
                        }
                      >
                        {displayLabel("member", m.status)}
                      </span>
                    </td>
                    <td className="store-team-actions" data-label="Thao tác">
                      {editable ? (
                        <TableActions>
                          <TableAction
                            icon={m.status === "active" ? Ban : Check}
                            disabled={busy !== null}
                            aria-label={
                              (m.status === "active"
                                ? "Thu hồi quyền của "
                                : "Kích hoạt quyền của ") + m.name
                            }
                            onClick={() =>
                              void update(m, {
                                role: m.role,
                                status:
                                  m.status === "active" ? "revoked" : "active",
                              })
                            }
                          >
                            {busy === m.id
                              ? "Đang lưu…"
                              : m.status === "active"
                                ? "Thu hồi"
                                : "Kích hoạt"}
                          </TableAction>
                        </TableActions>
                      ) : (
                        <span className="store-team-readonly">
                          {m.role === "owner" ? "Chủ cửa hàng" : "Chỉ xem"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="store-team-empty">Chưa có nhân sự trong cửa hàng.</p>
        )}
      </section>

      <div className={"store-team-lower" + (owner ? " has-invite" : "")}>
        {owner && (
          <form
            className="panel store-team-invite"
            aria-labelledby="store-invite-heading"
            onSubmit={async (e) => {
              e.preventDefault();
              if (locked.current) return;
              const body = Object.fromEntries(new FormData(e.currentTarget));
              locked.current = true;
              setBusy("invite");
              setInvite("");
              try {
                const result = await api("workspace/team/invite", "POST", body);
                setInvite(window.location.origin + result.url);
                await refresh();
              } catch (e) {
                toast((e as Error).message);
              } finally {
                locked.current = false;
                setBusy(null);
              }
            }}
          >
            <div className="store-team-section-heading">
              <h3 id="store-invite-heading">Mời nhân sự</h3>
              <p>
                Tạo liên kết mời và gửi đến đúng người để họ tham gia cửa hàng.
              </p>
            </div>
            <label className="field">
              Email
              <input
                type="email"
                name="email"
                placeholder="ten@email.com"
                autoComplete="email"
                required
                disabled={busy === "invite"}
              />
            </label>
            <label className="field">
              Vai trò
              <Select name="role" disabled={busy === "invite"}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {displayLabel("role", r)}
                  </option>
                ))}
              </Select>
            </label>
            <button className="button" disabled={busy !== null}>
              <UserPlus size={16} aria-hidden="true" />
              {busy === "invite" ? "Đang tạo lời mời…" : "Tạo lời mời"}
            </button>
            {invite && (
              <div className="store-team-invite-link" role="status">
                <strong>Liên kết mời đã sẵn sàng</strong>
                <p>Chia sẻ liên kết này với người được mời.</p>
                <a href={invite}>{invite}</a>
              </div>
            )}
          </form>
        )}
        <section
          className="panel store-team-invitations"
          aria-labelledby="store-invitations-heading"
        >
          <div className="store-team-section-heading">
            <h3 id="store-invitations-heading">
              Lời mời đã tạo{" "}
              <span className="store-team-count">
                {data.invitations.length}
              </span>
            </h3>
            <p>Theo dõi trạng thái tham gia của nhân sự được mời.</p>
          </div>
          {data.invitations.length ? (
            <ul className="store-team-invitation-list">
              {data.invitations.map((i) => {
                const expiry = parseDateTime(i.expires_at);
                const validDate = !Number.isNaN(expiry.getTime());
                const status =
                  i.status === "pending" &&
                  validDate &&
                  expiry.getTime() < Date.now()
                    ? "expired"
                    : i.status;
                return (
                  <li key={i.id}>
                    <div className="store-team-invitation-top">
                      <strong>{i.email}</strong>
                      <span
                        className={
                          "store-team-status " +
                          (status === "accepted"
                            ? "is-active"
                            : status === "pending"
                              ? "is-pending"
                              : "is-muted")
                        }
                      >
                        {displayLabel("invitation", status)}
                      </span>
                    </div>
                    <span>{displayLabel("role", i.role)}</span>
                    <small>
                      Hết hạn:{" "}
                      {validDate
                        ? formatDateTime(expiry)
                        : "Chưa xác định"}
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="store-team-empty">
              Chưa có lời mời nào. Lời mời mới sẽ xuất hiện tại đây.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
