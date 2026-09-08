export type AdminNotification = {
  key: string;
  type: "orders" | "inquiries" | "users";
  title: string;
  detail: string;
  createdAt: number;
  href: string;
};
