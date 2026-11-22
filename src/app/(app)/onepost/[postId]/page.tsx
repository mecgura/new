import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { PostStudio } from "@/components/onepost/post-studio";
import { isServiceEnabled } from "@/services/whatsapp/guards";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "OnePost post" };

export default async function OnePostStudioPage({ params }: { params: Promise<{ postId: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "ONEPOST"))) return <ServiceLocked name="OnePost — Content & PR Studio" />;
  const parsed = idSchema.safeParse((await params).postId);
  if (!parsed.success) notFound();
  return <PostStudio orgId={ctx.orgId} postId={parsed.data} />;
}
