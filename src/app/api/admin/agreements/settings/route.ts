import { handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { getProvider, providerSchema, saveProvider, templateStatus } from "@/services/agreements/agreements";

/** MECGURA's details printed on every agreement, the number links are sent from, and the WhatsApp template status. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const accounts = await db.whatsAppAccount.findMany({
    where: { status: "connected" },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, phoneNumber: true, organization: { select: { name: true } } },
  });
  return ok({ provider: await getProvider(), whatsapp: await templateStatus(), accounts: accounts.map((a) => ({ id: a.id, label: `${a.displayName} (${a.phoneNumber}) · ${a.organization.name}` })) });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const provider = await saveProvider(await readJson(req, providerSchema.strict()), admin.id, req);
  return ok({ provider, whatsapp: await templateStatus() });
});
