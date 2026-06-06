import { redirect } from "next/navigation";

export const metadata = { title: "图片生成" };

export default async function HistoryDetailPage({
  params: _params,
}: {
  params: Promise<{ id: string }>;
}) {
  void _params;
  redirect("/image");
}
