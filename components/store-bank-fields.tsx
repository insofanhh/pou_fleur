"use client";
import { useState } from "react";
import Select from "./ui-select";
import { banks, findBank } from "@/lib/bank-catalog";

export default function StoreBankFields({ bank }: { bank: any }) {
  const [code, setCode] = useState(findBank(bank?.bank_code || "")?.bin || "");
  const selected = findBank(code);
  return (
    <div className="form-grid">
      <label className="field">
        Ngân hàng nhận tiền
        <Select
          name="bank_code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          <option value="">Chọn ngân hàng</option>
          {banks.map((b) => (
            <option key={b.bin} value={b.bin}>
              {b.name} · {b.bin}
            </option>
          ))}
        </Select>
      </label>
      <input type="hidden" name="bank_name" value={selected?.name || ""} />
      <label className="field">
        Số tài khoản
        <input
          name="account_number"
          inputMode="numeric"
          defaultValue={bank?.account_number || ""}
        />
      </label>
      <label className="field">
        Chủ tài khoản
        <input
          name="account_holder"
          defaultValue={bank?.account_holder || ""}
        />
      </label>
    </div>
  );
}
