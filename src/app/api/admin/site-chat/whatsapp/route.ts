import { z } from "zod";
import { db } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { setWaBot, waBotAccountId } from "@/services/site/lead-chat";

/** Which WhatsApp number the built-in assistant answers on (null = none). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const rows = await db.whatsAppAccount.findMany({
    where: { status: { in: ["connected", "demo"] } },
    select: { id: true, displayName: true, phoneNumber: true, isDemo: true, organization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({
    accountId: await waBotAccountId(),
    accounts: rows.map((a) => ({ id: a.id, label: `${a.displayName || a.phoneNumber} (${a.phoneNumber}) · ${a.organization.name}${a.isDemo ? " · demo" : ""}` })),
  });
});

const putSchema = z.object({ accountId: z.string().trim().min(1).max(60).nullable() }).strict();

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const { accountId } = await readJson(req, putSchema);
  await setWaBot(accountId, admin.id, req);
  return ok({ accountId: await waBotAccountId() });
});
