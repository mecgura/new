import { clientIp, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { signAgreement, signSchema } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ token: string }> };

/** Electronic acceptance: typed name + consent tick. Time, IP, device and a hash of the text are recorded. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  enforceRateLimit(`agreement:sign:${ip}`, 10, 10 * 60_000);
  const token = (await params).token;
  const input = await readJson(req, signSchema);
  return ok({ agreement: await signAgreement(token, input, ip, req.headers.get("user-agent") ?? "", req) });
});
