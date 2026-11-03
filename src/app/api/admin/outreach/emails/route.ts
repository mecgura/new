import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { findEmails } from "@/services/marketing/outreach";

export const maxDuration = 30;

/** Public email addresses on a business's own website (home page and contact page). */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  enforceRateLimit(`email-find:${admin.id}`, 60, 60_000);
  const { website } = await readJson(req, z.object({ website: z.string().trim().url().max(300) }).strict());
  return ok({ emails: await findEmails(website) });
});
