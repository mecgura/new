import { handle, ok, readJson, clientIp } from "@/lib/api";
import { siteLeadSchema, submitSiteLead } from "@/services/marketing/site-form";

/** Public lead form on mecgura.tech (demo request, template pack, referral). Rate limited, honeypotted, consent required. */
export const POST = handle(async (req) => {
  const input = await readJson(req, siteLeadSchema);
  return ok(await submitSiteLead(input, clientIp(req), req), { status: 201 });
});
