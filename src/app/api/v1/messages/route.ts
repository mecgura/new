import { ok, readJson } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiSendSchema } from "@/lib/api-public";
import { apiSend } from "@/services/api/public";

/** Sends a WhatsApp message. Consent, suppression, the 24-hour window and template approval are enforced exactly as in the dashboard. */
export const POST = apiHandle("messages:send", async (req, _ctx, p) => ok(await apiSend(p, await readJson(req, apiSendSchema), req), { status: 201 }));
