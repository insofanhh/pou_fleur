"use client";
import DateInput from "./date-input";
import { FileText, RotateCw, Search } from "lucide-react";
import Link from "./routing";
import { statusNames } from "./pages";
import Select from "./ui-select";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="board-filter-select">
      <span className="board-filter-label">{label}</span>
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

const paymentOptions = [
  { value: "", label: "Tất cả thanh toán" },
  ...["unpaid", "partially_paid", "paid", "partially_refunded", "refunded"].map(
    (value) => ({ value, label: statusNames[value] || value }),
  ),
];
const sourceOptions = [
  { value: "", label: "Tất cả nguồn" },
  { value: "web", label: "Website" },
  { value: "manual", label: "Thủ công" },
];

export function OrderDraftsLink() {
  return (
    <Link href="/admin/orders/new?drafts=1" className="board-filter-drafts">
      <FileText size={16} aria-hidden="true" />
      Đơn nháp
    </Link>
  );
}

export default function BoardToolbar({
  search,
  date,
  payment,
  source,
  method,
  fulfillment,
  onFulfillment,
  onMethod,
  onSearch,
  onDate,
  onPayment,
  onSource,
  onRefresh,
}: {
  search: string;
  date: string;
  payment: string;
  source: string;
  method: string;
  fulfillment: string;
  onFulfillment: (value: string) => void;
  onMethod: (value: string) => void;
  onSearch: (value: string) => void;
  onDate: (value: string) => void;
  onPayment: (value: string) => void;
  onSource: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="board-filter-toolbar"
      role="group"
      aria-label="Bộ lọc đơn hàng"
    >
      <OrderDraftsLink />
      <label className="board-filter-search">
        <span className="board-filter-label">Tìm đơn hàng</span>
        <span className="board-filter-search-control">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Mã đơn, tên khách, số điện thoại…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </span>
      </label>
      <label className="board-filter-date">
        <span className="board-filter-label">Ngày giao / nhận</span>
        <DateInput
          type="date"
          value={date}
          onChange={(event) => onDate(event.target.value)}
        />
      </label>
      <div className="board-filter-payment">
        <FilterSelect
          label="Thanh toán"
          value={payment}
          options={paymentOptions}
          onChange={onPayment}
        />
      </div>
      <div className="board-filter-source">
        <FilterSelect
          label="Nguồn tạo đơn"
          value={source}
          options={sourceOptions}
          onChange={onSource}
        />
      </div>
      <div className="board-filter-method">
        <FilterSelect
          label="Phương thức"
          value={method}
          onChange={onMethod}
          options={[
            { value: "", label: "Tất cả phương thức" },
            { value: "cod", label: "COD" },
            { value: "bank", label: "Chuyển khoản" },
            { value: "cod_due", label: "COD còn phải thu" },
            { value: "cod_delivered_due", label: "COD đã giao chưa thu đủ" },
          ]}
        />
      </div>
      <div className="board-filter-fulfillment">
        <FilterSelect label="Nhận hoa" value={fulfillment} onChange={onFulfillment} options={[
          { value: "", label: "Tất cả hình thức" }, { value: "delivery", label: "Giao tận nơi" }, { value: "pickup", label: "Lấy tại cửa hàng" },
        ]} />
      </div>
      <button
        type="button"
        className="board-filter-refresh"
        aria-label="Làm mới"
        title="Làm mới"
        onClick={onRefresh}
      >
        <RotateCw size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
