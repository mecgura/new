import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { ContactsApp } from "@/components/contacts/contacts-app";
import { NoWorkspace } from "@/components/whatsapp/states";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ leadStatus?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const { leadStatus } = await searchParams;
  return <ContactsApp orgId={ctx.orgId} perms={ctx.perms} initialLeadStatus={typeof leadStatus === "string" && /^[a-z_]{1,20}$/.test(leadStatus) ? leadStatus : ""} />;
}
