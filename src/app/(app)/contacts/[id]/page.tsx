import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInboxContext } from "@/lib/inbox-context";
import { idSchema } from "@/lib/validations";
import { ContactProfile } from "@/components/contacts/contact-profile";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  return <ContactProfile orgId={ctx.orgId} contactId={id.data} perms={ctx.perms} accounts={[...ctx.accounts]} />;
}
