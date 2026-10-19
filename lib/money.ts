const formatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export const formatMoney = (value: number) => formatter.format(value) + " VNĐ";
