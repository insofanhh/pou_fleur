import type { Metadata } from "next";
import "./globals.css";
import { Provider } from "@/components/context";
import SectionReveal from "@/components/section-reveal";
import { sectionMotionStyles } from "@/lib/section-motion";
export const metadata: Metadata = {
  title: {
    default: "Fleur — Hoa cho những điều không thể nói",
    template: "%s | Fleur",
  },
  description:
    "Những thiết kế hoa tinh tế, được làm bằng cả sự tận tâm. Chọn hoa, gửi lời thương và đặt lịch giao tại Fleur.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <style id="section-motion">{sectionMotionStyles}</style>
      </head>
      <body>
        <Provider>
          {children}
          <SectionReveal />
        </Provider>
      </body>
    </html>
  );
}
