"use client";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import Select from "./ui-select";
import { TableAction, TableActions } from "./table-actions";
import { api, useShop } from "./context";
import { productSlug } from "@/lib/product-images";

type Item = { id: number; name: string; slug: string; description: string };
type Kind = "categories" | "flower_components";
const titles = { categories: "Danh mục", flower_components: "Thành phần hoa" };

function TaxonomyEditor({
  kind,
  record,
  saved,
  close,
  autoSelect = false,
}: {
  kind: Kind;
  record?: Item;
  saved: (item: Item) => void;
  close: () => void;
  autoSelect?: boolean;
}) {
  const [name, setName] = useState(record?.name || "");
  const [slug, setSlug] = useState(record?.slug || "");
  const [description, setDescription] = useState(record?.description || "");
  const [manualSlug, setManualSlug] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    if (busy) return;
    if (!name.trim() || !/^[a-z0-9-]+$/.test(slug)) {
      setError(
        "Nhập tên và đường dẫn hợp lệ (chữ thường không dấu, số, dấu gạch ngang).",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "admin/" + kind + (record ? "/" + record.id : ""),
        record ? "PATCH" : "POST",
        { name: name.trim(), slug, description },
      );
      saved({
        id: record?.id || result.id,
        name: name.trim(),
        slug,
        description,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      className="taxonomy-editor"
      disabled={busy}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <legend>
        {record ? "Chỉnh sửa" : "Tạo mới"} {titles[kind].toLowerCase()}
      </legend>
      <div className="taxonomy-editor-fields">
        <label className="field">
          Tên {titles[kind].toLowerCase()}
          <input
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              if (!manualSlug) setSlug(productSlug(e.target.value));
            }}
          />
        </label>
        <label className="field">
          Đường dẫn
          <input
            value={slug}
            maxLength={160}
            onChange={(e) => {
              setManualSlug(true);
              setSlug(e.target.value);
            }}
          />
        </label>
        <label className="field span-2">
          Mô tả (tuỳ chọn)
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={15000}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="button compact"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy
            ? "Đang lưu..."
            : record
              ? "Lưu thay đổi"
              : autoSelect
                ? "Tạo và chọn"
                : "Tạo mới"}
        </button>
        <button
          type="button"
          className="button outline compact"
          onClick={close}
        >
          Huỷ
        </button>
      </div>
    </fieldset>
  );
}

export function ProductTaxonomyFields({
  record,
  disabled,
  onReady,
}: {
  record: any;
  disabled: boolean;
  onReady: (ready: boolean) => void;
}) {
  const [options, setOptions] = useState<{
    categories: Item[];
    components: Item[];
  }>({ categories: [], components: [] });
  const [category, setCategory] = useState(String(record.category_id || ""));
  const [ids, setIds] = useState<number[]>(record.flower_component_ids || []);
  const [other, setOther] = useState(
    record.flower_other ?? record.flowers ?? "",
  );
  const [creating, setCreating] = useState<Kind | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api("admin/product-taxonomy");
      setOptions(result);
      setCategory(
        (current) => current || String(result.categories[0]?.id || ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    onReady(!loading && !error && !creating);
  }, [loading, error, creating, onReady]);
  const flowers = [
    ...options.components.filter((c) => ids.includes(c.id)).map((c) => c.name),
    other.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="product-taxonomy-fields span-2">
      {error && (
        <div className="span-2">
          <p className="error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="button outline compact"
            onClick={() => void load()}
          >
            Tải lại danh mục
          </button>
        </div>
      )}
      <div className="field">
        <span>Danh mục</span>
        <Select
          aria-label="Danh mục"
          name="category_id"
          required
          value={category}
          disabled={disabled || loading}
          onChange={(e) => {
            if (e.target.value === "__create__") setCreating("categories");
            else setCategory(e.target.value);
          }}
        >
          <option value="" disabled>
            {loading ? "Đang tải..." : "Chọn danh mục"}
          </option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__create__">＋ Tạo danh mục mới</option>
        </Select>
      </div>
      <div className="field">
        <span>Thành phần hoa</span>
        <Select
          aria-label="Thành phần hoa"
          value=""
          disabled={disabled || loading}
          onChange={(e) => {
            if (e.target.value === "__create__")
              setCreating("flower_components");
            else if (e.target.value)
              setIds((current) => [...current, Number(e.target.value)]);
          }}
        >
          <option value="">
            {loading ? "Đang tải..." : "Chọn thành phần hoa"}
          </option>
          {options.components
            .filter((c) => !ids.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          <option value="__create__">＋ Tạo thành phần hoa mới</option>
        </Select>
        <div className="taxonomy-chips">
          {options.components
            .filter((c) => ids.includes(c.id))
            .map((c) => (
              <span className="taxonomy-chip" key={c.id}>
                {c.name}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={"Bỏ " + c.name}
                  onClick={() =>
                    setIds((current) => current.filter((id) => id !== c.id))
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
        </div>
      </div>
      {creating && (
        <div className="span-2">
          <TaxonomyEditor
            autoSelect
            key={creating}
            kind={creating}
            close={() => setCreating(null)}
            saved={(item) => {
              if (creating === "categories") {
                setOptions((o) => ({
                  ...o,
                  categories: [...o.categories, item],
                }));
                setCategory(String(item.id));
              } else {
                setOptions((o) => ({
                  ...o,
                  components: [...o.components, item],
                }));
                setIds((current) => [...current, item.id]);
              }
              setCreating(null);
            }}
          />
        </div>
      )}
      <label className="field span-2">
        Thành phần khác (tuỳ chọn)
        <input
          aria-label="Thành phần khác (tuỳ chọn)"
          value={other}
          disabled={disabled}
          maxLength={255}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Ví dụ: lá bạc, phụ kiện trang trí..."
        />
        <small>
          Chọn nhiều thành phần hoa ở trên. Nội dung đã nhập ở sản phẩm cũ được
          giữ tại đây.
        </small>
      </label>
      <input
        type="hidden"
        name="flower_component_ids"
        value={JSON.stringify(ids)}
      />
      <input type="hidden" name="flower_other" value={other} />
      <input type="hidden" name="flowers" value={flowers} />
    </div>
  );
}

export default function ProductTaxonomyManager({
  categories,
  refresh,
}: {
  categories: Item[];
  refresh: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [kind, setKind] = useState<Kind>("categories");
  const [components, setComponents] = useState<Item[]>([]);
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  async function load() {
    setError("");
    try {
      setComponents(await api("admin/flower_components"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const items = (kind === "categories" ? categories : components).filter((c) =>
    (c.name + " " + c.description).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="taxonomy-manager">
      <div className="taxonomy-manager-header">
        <div
          className="taxonomy-tabs"
          role="tablist"
          aria-label="Loại danh mục"
        >
          {(["categories", "flower_components"] as Kind[]).map((k) => (
            <button
              type="button"
              role="tab"
              aria-selected={kind === k}
              key={k}
              onClick={() => {
                setKind(k);
                setEditing(undefined);
                setSearch("");
              }}
            >
              {k === "categories" ? "Danh mục sản phẩm" : "Thành phần hoa"}
            </button>
          ))}
        </div>
        <button className="button compact" onClick={() => setEditing(null)}>
          <Plus size={16} />
          Thêm {titles[kind].toLowerCase()}
        </button>
      </div>
      <p className="small">
        Quản lý dữ liệu dùng chung khi thêm hoặc chỉnh sửa sản phẩm của cửa
        hàng.
      </p>
      {editing !== undefined && (
        <TaxonomyEditor
          key={kind + (editing?.id || "new")}
          kind={kind}
          record={editing || undefined}
          close={() => setEditing(undefined)}
          saved={(item) => {
            if (kind === "flower_components")
              setComponents((current) => [
                item,
                ...current.filter((c) => c.id !== item.id),
              ]);
            setEditing(undefined);
            toast("Đã lưu thay đổi.");
            void refresh();
          }}
        />
      )}
      {error && (
        <div>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            className="button outline compact"
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </div>
      )}
      <div
        className="admin-table-panel"
        role="tabpanel"
        aria-label={titles[kind]}
      >
        <div className="table-toolbar">
          <label className="search-field">
            <input
              aria-label="Tìm danh mục hoặc thành phần hoa"
              placeholder="Tìm kiếm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="small">{items.length} bản ghi</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{titles[kind]}</th>
                <th>Đường dẫn</th>
                <th>Mô tả</th>
                <th className="table-actions-heading" scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.slug}</td>
                  <td>{item.description || "—"}</td>
                  <td>
                    <TableActions className="taxonomy-actions">
                      <TableAction icon={Pencil}
                        aria-label={"Sửa " + item.name}
                        title="Chỉnh sửa"
                        onClick={() => setEditing(item)}
                      >
                        Sửa
                      </TableAction>
                      <TableAction icon={Trash2}
                        aria-label={"Xoá " + item.name}
                        title="Xoá"
                        disabled={deleting !== null}
                        onClick={async () => {
                          if (!confirm("Xoá " + item.name + "?")) return;
                          setDeleting(item.id);
                          try {
                            await api(
                              "admin/" + kind + "/" + item.id,
                              "DELETE",
                              {},
                            );
                            if (kind === "flower_components")
                              setComponents((current) =>
                                current.filter((c) => c.id !== item.id),
                              );
                            toast("Đã xoá.");
                            await refresh();
                          } catch (e) {
                            toast((e as Error).message);
                          } finally {
                            setDeleting(null);
                          }
                        }}
                      >
                        Xoá
                      </TableAction>
                    </TableActions>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    {kind === "flower_components" && loading
                      ? "Đang tải thành phần hoa..."
                      : "Chưa có dữ liệu. Thêm mới để sử dụng trong sản phẩm."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
