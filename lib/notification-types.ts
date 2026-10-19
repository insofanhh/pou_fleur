export type AdminNotification = {
  key: string;
  type: "orders" | "inquiries" | "users" | "system";
  title: string;
  detail: string;
  createdAt: number;
  href: string;
};
