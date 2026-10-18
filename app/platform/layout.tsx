import type { ReactNode } from "react";
import Platform from "@/components/platform";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Platform />
      {children}
    </>
  );
}
