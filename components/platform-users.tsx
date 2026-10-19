"use client";
import { formatDateTime } from "@/lib/date-time";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import { useEffect, useState, type FormEvent } from "react";
import { Search, Plus, Ghost, Pencil, Trash2, RotateCcw } from "lucide-react";
import { api, useShop } from "./context";
import { displayLabel, auditAction } from "@/lib/display-labels";
import PlatformDialog from "./platform-dialog";
import PasswordField from "./password-field";

type Account = {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  active: number;
  platformAdmin: number;
  version: number;
  deleted_at: string | null;
  created_at: string;
  memberships: Array<{
    store_id: number;
    store_name: string;
    role: string;
    status: string;
  }>;
};
type Mode = "view" | "edit" | "delete" | "ghost" | "restore" | "create";
function platformMembershipLabel(membership: { role: string; store_name: string }) {
  const role = membership.role === "owner" ? "Quản trị cửa hàng" : displayLabel("role", membership.role);
  return role + " · " + membership.store_name;
}
export default function PlatformUsers({ refreshKey }: { refreshKey: number }) {
  const { user: actor, toast } = useShop();
  const [search, setSearch] = useState(""),
    [state, setState] = useState("current"),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<{
      users: Account[];
      total: number;
      page: number;
      pages: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<{
      mode: Mode;
      account?: Account;
      detail?: any;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api(
        `platform/users?q=${encodeURIComponent(search)}&state=${state}&page=${page}`,
      )
        .then((d) => {
          if (active) {
            if (page > d.pages) setPage(d.pages);
            else setData(d);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, state, page, revision, refreshKey]);
  async function open(mode: Mode, account?: Account) {
    setFormError("");
    if (mode === "view" || mode === "edit") {
      try {
        const detail = await api("platform/users/" + account!.id);
        setDialog({ mode, account: detail.user, detail });
      } catch (e) {
        toast((e as Error).message);
      }
    } else setDialog({ mode, account });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog || busy) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const { mode, account } = dialog;
    setBusy(true);
    setFormError("");
    try {
      const root = "platform/users" + (account ? "/" + account.id : "");
      const result = await api(
        root +
          (mode === "ghost" ? "/ghost" : mode === "restore" ? "/restore" : ""),
        mode === "delete" ? "DELETE" : mode === "edit" ? "PATCH" : "POST",
        {
          ...f,
          ...(mode === "create" || mode === "edit"
            ? {
                active: f.active === "on",
                platformAdmin: f.platformAdmin === "on",
              }
            : {}),
          ...(account ? { version: account.version } : {}),
        },
      );
      if (mode === "ghost") {
        window.location.assign(result.redirect);
        return;
      }
      setDialog(null);
      setRevision((v) => v + 1);
      toast(
        mode === "delete"
          ? "Đã xóa mềm tài khoản."
          : mode === "restore"
            ? "Đã khôi phục tài khoản ở trạng thái khóa."
            : "Đã lưu tài khoản.",
      );
      if (account?.id === actor?.id) {
        window.location.reload();
        return;
      }
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const account = dialog?.account;
  return (
    <div className="platform-users" data-no-fade-in>
      <div className="board-toolbar platform-users-toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            type="search"
            aria-label="Tìm tài khoản"
            placeholder="Tìm tên hoặc email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select
          aria-label="Trạng thái tài khoản"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="current">Tài khoản hiện có</option>
          <option value="active">Đang hoạt động</option>
          <option value="locked">Đã khóa</option>
          <option value="deleted">Đã xóa</option>
        </Select>
        <button className="button" onClick={() => void open("create")}>
          <Plus size={16} />
          Thêm tài khoản
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel platform-users-list" aria-busy={loading}>
        <div className="platform-users-count">
          <span>{data?.total ?? 0} tài khoản</span>
          {loading && <span role="status">Đang tải…</span>}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Quyền & cửa hàng</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th className="table-actions-heading" scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void open("view", u)}
                    >
                      {u.name}
                    </button>
                    <small>{u.email}</small>
                  </td>
                  <td>
                    <div className="platform-user-role-list">
                      {!!u.platformAdmin && <span>Quản trị nền tảng</span>}
                      {u.memberships.map((membership) => (
                        <span key={membership.store_id}>
                          {platformMembershipLabel(membership)}
                          {membership.status !== "active" && " · Đã thu hồi"}
                        </span>
                      ))}
                      {!u.platformAdmin && !u.memberships.length && <span>Người dùng</span>}
                    </div>
                  </td>
                  <td>
                    <span className="tag">
                      {u.deleted_at
                        ? "Đã xóa"
                        : u.active
                          ? "Hoạt động"
                          : "Đã khóa"}
                    </span>
                  </td>
                  <td>{formatDateTime(u.created_at)}</td>
                  <td>
                    <TableActions className="platform-user-actions">
                      {u.deleted_at ? (
                        <TableAction icon={RotateCcw}
                          onClick={() => void open("restore", u)}
                        >
                          Khôi phục
                        </TableAction>
                      ) : (
                        <>
                          <TableAction icon={Pencil}
                            onClick={() => void open("edit", u)}
                          >
                            Sửa
                          </TableAction>
                          {!!u.active &&
                            !u.platformAdmin &&
                            u.id !== actor?.id && (
                              <TableAction icon={Ghost}
                                onClick={() => void open("ghost", u)}
                              >
                                Ghost
                              </TableAction>
                            )}
                          {u.id !== actor?.id && (
                            <TableAction icon={Trash2}
                              onClick={() => void open("delete", u)}
                            >
                              Xóa
                            </TableAction>
                          )}
                        </>
                      )}
                    </TableActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && !data?.users.length && (
          <p className="empty">Không tìm thấy tài khoản phù hợp.</p>
        )}
        <div className="order-pagination">
          <button
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Trang trước
          </button>
          <span>
            Trang {page} / {data?.pages || 1}
          </span>
          <button
            disabled={loading || page >= (data?.pages || 1)}
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </button>
        </div>
      </div>
      {dialog && (
        <PlatformDialog
          title={
            dialog.mode === "create"
              ? "Thêm tài khoản"
              : dialog.mode === "edit"
                ? "Sửa tài khoản"
                : dialog.mode === "view"
                  ? "Hồ sơ tài khoản"
                  : dialog.mode === "ghost"
                    ? "Truy cập với tư cách người dùng"
                    : dialog.mode === "restore"
                      ? "Khôi phục tài khoản"
                      : "Xóa tài khoản"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          {dialog.mode === "view" ? (
            <>
              <h3>{account!.name}</h3>
              <p>{account!.email}</p>
              <p>{account!.phone || "Chưa có số điện thoại"}</p>
              <p>{account!.address || "Chưa có địa chỉ"}</p>
              <p>
                Trạng thái:{" "}
                {account!.deleted_at
                  ? "Đã xóa"
                  : account!.active
                    ? "Hoạt động"
                    : "Đã khóa"}
              </p>
              <h3>Cửa hàng và vai trò</h3>
              {dialog.detail.memberships.length ? (
                dialog.detail.memberships.map((m: any) => (
                  <p key={m.store_id}>
                    {platformMembershipLabel(m)} ·{" "}
                    {m.status === "active" ? "Hoạt động" : "Đã thu hồi"}
                  </p>
                ))
              ) : (
                <p>Chưa tham gia cửa hàng.</p>
              )}
              <h3>Nhật ký quản trị</h3>
              <div className="platform-user-audit">
                {dialog.detail.audit.length ? (
                  dialog.detail.audit.map((a: any) => (
                    <p key={a.id}>
                      <strong>{auditAction(a.action)}</strong>
                      <br />
                      {a.actor_name} · {formatDateTime(a.created_at)}
                    </p>
                  ))
                ) : (
                  <p>Chưa có thao tác quản trị.</p>
                )}
              </div>
              {!account!.deleted_at && (
                <button
                  className="button"
                  onClick={() => void open("edit", account)}
                >
                  Sửa tài khoản
                </button>
              )}
            </>
          ) : (
            <form onSubmit={(e) => void submit(e)}>
              {dialog.mode === "create" || dialog.mode === "edit" ? (
                <>
                  <div className="platform-user-fields">
                    <label className="field">
                      Họ tên
                      <input
                        name="name"
                        minLength={2}
                        maxLength={100}
                        defaultValue={account?.name || ""}
                        required
                      />
                    </label>
                    <label className="field">
                      Email
                      <input
                        name="email"
                        type="email"
                        maxLength={190}
                        defaultValue={account?.email || ""}
                        required
                      />
                    </label>
                    <label className="field">
                      Số điện thoại
                      <input
                        name="phone"
                        type="tel"
                        maxLength={30}
                        defaultValue={account?.phone || ""}
                      />
                    </label>
                    <PasswordField
                      label={
                        dialog.mode === "create"
                          ? "Mật khẩu ban đầu"
                          : "Mật khẩu mới (để trống nếu giữ nguyên)"
                      }
                      name="password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required={dialog.mode === "create"}
                    />
                  </div>
                  <label className="field">
                    Địa chỉ
                    <textarea
                      name="address"
                      maxLength={500}
                      defaultValue={account?.address || ""}
                    />
                  </label>
                  <label className="platform-user-check">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={account ? !!account.active : true}
                    />
                    Cho phép đăng nhập
                  </label>
                  <label className="platform-user-check">
                    <input
                      name="platformAdmin"
                      type="checkbox"
                      defaultChecked={!!account?.platformAdmin}
                    />
                    Quyền quản trị toàn nền tảng
                  </label>
                  <p className="small">
                    Quyền tại từng cửa hàng được quản lý riêng. Đổi email, mật
                    khẩu, quyền hoặc khóa tài khoản sẽ thu hồi các phiên đăng
                    nhập.
                  </p>
                </>
              ) : (
                <>
                  <h3>{account!.name}</h3>
                  <p>{account!.email}</p>
                  <p>
                    {dialog.mode === "ghost"
                      ? "Phiên hỗ trợ tối đa 20 phút, dùng đúng quyền của người dùng và ghi nhật ký. Không thể thay đổi tài khoản, phân quyền hoặc đăng ký push trong phiên Ghost."
                      : dialog.mode === "delete"
                        ? "Xóa mềm sẽ khóa đăng nhập và thu hồi các phiên. Lịch sử đơn hàng được giữ lại. Tài khoản sở hữu cửa hàng chưa đóng không thể xóa."
                        : "Tài khoản được khôi phục ở trạng thái khóa và không có quyền quản trị nền tảng. Bạn có thể mở khóa sau khi kiểm tra hồ sơ."}
                  </p>
                </>
              )}
              <label className="field">
                Lý do thao tác
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={500}
                  required
                  placeholder="Ghi lý do để lưu vào nhật ký…"
                />
              </label>
              {formError && (
                <p className="error" role="alert">
                  {formError}
                </p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Hủy
                </button>
                <button className="button" disabled={busy}>
                  {busy
                    ? "Đang xử lý…"
                    : dialog.mode === "ghost"
                      ? "Bắt đầu Ghost"
                      : dialog.mode === "delete"
                        ? "Xác nhận xóa"
                        : dialog.mode === "restore"
                          ? "Khôi phục tài khoản"
                          : "Lưu tài khoản"}
                </button>
              </div>
            </form>
          )}
        </PlatformDialog>
      )}
    </div>
  );
}
