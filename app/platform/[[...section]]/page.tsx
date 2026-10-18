import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  return { title: "Fleurious · " + (section[0] || "platform") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  if (
    section.length > 1 ||
    (section[0] &&
      !["overview", "stores", "invoices", "users", "health"].includes(
        section[0],
      ))
  )
    notFound();
  return null;
}
