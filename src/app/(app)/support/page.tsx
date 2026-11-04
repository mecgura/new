import type { Metadata } from "next";
import { getInboxContext } from "@/lib/inbox-context";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ClientSupport } from "@/components/support/support-ui";

export const metadata: Metadata = { title: "Help & support" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  const { ticket } = await searchParams;
  return <ClientSupport orgId={ctx.orgId} initialTicket={ticket && /^[a-z0-9]{10,40}$/i.test(ticket) ? ticket : null} />;
}
