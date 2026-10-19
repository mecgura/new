import { db } from "@/lib/db";

const DAY = 86_400_000;

/** Click-to-WhatsApp performance for one workspace: which ads started chats, and how many of those customers replied again or opted in. */
export async function getAdsSummary(organizationId: string, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await db.adReferral.findMany({ where: { organizationId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000, select: { sourceId: true, sourceType: true, headline: true, contactId: true, createdAt: true } });
  const groups = new Map<string, { key: string; sourceId: string; sourceType: string; headline: string; chats: number; contacts: Set<string>; lastAt: Date }>();
  for (const r of rows) {
    const key = r.sourceId || r.headline || "unknown";
    const g = groups.get(key) ?? { key, sourceId: r.sourceId, sourceType: r.sourceType, headline: r.headline, chats: 0, contacts: new Set<string>(), lastAt: r.createdAt };
    g.chats++;
    g.contacts.add(r.contactId);
    if (!g.headline && r.headline) g.headline = r.headline;
    groups.set(key, g);
  }
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const optedIn = contactIds.length ? await db.contact.count({ where: { organizationId, id: { in: contactIds.slice(0, 5000) }, optInStatus: "opted_in" } }) : 0;
  const ads = [...groups.values()]
    .map((g) => ({ sourceId: g.sourceId, sourceType: g.sourceType, headline: g.headline, chats: g.chats, customers: g.contacts.size, lastAt: g.lastAt }))
    .sort((a, b) => b.chats - a.chats)
    .slice(0, 20);
  return { days, totalChats: rows.length, customers: contactIds.length, optedIn, ads };
}
