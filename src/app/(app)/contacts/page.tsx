import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { ContactsApp } from "@/components/contacts/contacts-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  return <ContactsApp orgId={ctx.orgId} perms={ctx.perms} />;
}
