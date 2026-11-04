import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AdminSupport } from "@/components/support/support-ui";

export const metadata: Metadata = { title: "Support desk" };

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" } });
  const { ticket } = await searchParams;
  return <AdminSupport admins={admins.map((a) => ({ id: a.id, name: a.name || a.email }))} initialTicket={ticket && /^[a-z0-9]{10,40}$/i.test(ticket) ? ticket : null} />;
}
