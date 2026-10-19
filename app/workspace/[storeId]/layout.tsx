import type { ReactNode } from "react";
import WorkspaceLayout, {
  workspaceMetadata,
} from "@/components/workspace-layout";

export const dynamic = "force-dynamic";
type Props = { children: ReactNode; params: Promise<{ storeId: string }> };

export async function generateMetadata({ params }: Props) {
  return workspaceMetadata((await params).storeId);
}

export default async function Layout({ children, params }: Props) {
  return (
    <WorkspaceLayout storeRef={(await params).storeId}>
      {children}
    </WorkspaceLayout>
  );
}
