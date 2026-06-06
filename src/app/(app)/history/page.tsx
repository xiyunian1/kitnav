import { redirect } from "next/navigation";

export const metadata = { title: "图片生成" };

export default async function HistoryPage({
  searchParams: _searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  void _searchParams;
  redirect("/image");
}
