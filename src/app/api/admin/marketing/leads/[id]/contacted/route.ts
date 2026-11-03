import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { followUpText, markContacted } from "@/services/marketing/leads";
import { outreachQueue } from "@/services/marketing/outreach";

type Ctx = { params: Promise<{ id: string }> };

/** The admin opened WhatsApp for this lead. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  // Cold outreach to Maps leads keeps to the daily WhatsApp limit, so the number doesn't look like a spammer.
  const l = await db.marketingLead.findUnique({ where: { id }, select: { source: true, lastContactAt: true } });
  if (l?.source === "maps" && !l.lastContactAt && (await outreachQueue()).whatsappLeft <= 0) throw new ApiError("RATE_LIMITED", "Today's WhatsApp outreach limit is reached. Continue tomorrow so your number stays safe.");
  const lead = await markContacted(id, admin.id);
  return ok({ lead, followUp: followUpText(lead) });
});
