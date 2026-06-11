import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPptProject } from "@/lib/ppt";
import { PptPresenter } from "./ppt-presenter";

export const metadata = { title: "PPT 演示" };

export default async function PptPresentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const project = await getPptProject(session.user.id, id);
  if (!project) notFound();

  return <PptPresenter project={project} />;
}
