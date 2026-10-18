import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import Admin from "./admin";
import { catalogForRoute } from "@/lib/catalog";
import { storeBy, publicStore } from "@/lib/stores";
import { withStore } from "@/lib/tenant";
import { currentUser, ghostContext } from "@/lib/auth";
import { storeApprovalRequired } from "@/lib/platform-settings";

const workspaceStore = cache(async (ref: string) => {
  const store = await storeBy(ref).catch(() => null);
  if (!store) notFound();
  return store;
});

export async function workspaceMetadata(ref: string) {
  const store = await workspaceStore(ref);
  return {
    title: store.name + " · Fleurious",
    description: store.description,
  };
}

// Keep the sidebar, notifications and menu scroll mounted between workspace pages.
export default async function WorkspaceLayout({
  storeRef,
  children,
}: {
  storeRef: string;
  children: ReactNode;
}) {
  const store = await workspaceStore(storeRef);
  if (store.status !== "approved" && (await storeApprovalRequired())) {
    if (!(await ghostContext())) {
      const user = await currentUser();
      if (!user)
        redirect("/login?next=" + encodeURIComponent("/workspace/" + store.id));
      redirect("/start/pending?store=" + store.id);
    }
  }
  const data = await withStore(store.id, () => catalogForRoute("admin"));
  return (
    <>
      <Admin
        data={{
          ...data,
          store: publicStore(store),
          features: {
            goong: !!process.env.GOONG_API_KEY,
            google:
              !!process.env.GOOGLE_CLIENT_ID &&
              !!process.env.GOOGLE_CLIENT_SECRET,
          },
        }}
      />
      {children}
    </>
  );
}
