import { clientIp, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientDetailsSchema, clientUpdateDetails, publicAgreement } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ token: string }> };

/** The client's agreement page data. The secret token in the link is the only key. */
export const GET = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`agreement:get:${clientIp(req)}`, 120, 60_000);
  return ok({ agreement: await publicAgreement((await params).token, false) });
});

/** The client corrects their details before signing. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`agreement:write:${clientIp(req)}`, 30, 60_000);
  const token = (await params).token;
  const input = await readJson(req, clientDetailsSchema);
  return ok({ agreement: await clientUpdateDetails(token, input, req) });
});
