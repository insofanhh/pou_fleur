import { notFound } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  if (section.length > 1 && section.join("/") !== "orders/new") notFound();
  // The persistent layout reads the pathname and renders the selected workspace view.
  return null;
}
