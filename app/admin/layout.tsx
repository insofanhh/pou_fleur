import type { ReactNode } from "react";
import WorkspaceLayout, {
  workspaceMetadata,
} from "@/components/workspace-layout";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return workspaceMetadata("1");
}
export default function Layout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout storeRef="1">{children}</WorkspaceLayout>;
}
