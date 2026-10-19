"use client";
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

export default function BoardToolbar({
  search,
  date,
  payment,
  source,
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
      <Link href="/admin/orders/new?drafts=1" className="board-filter-drafts">
        <FileText size={16} aria-hidden="true" />
        Đơn nháp
      </Link>
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
        <span className="board-filter-label">Ngày giao</span>
        <input
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
      <button
        type="button"
        className="board-filter-refresh"
        onClick={onRefresh}
      >
        <RotateCw size={15} aria-hidden="true" />
        Làm mới
      </button>
    </div>
  );
}
