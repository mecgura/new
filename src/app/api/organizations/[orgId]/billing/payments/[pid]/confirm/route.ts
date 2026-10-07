import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { completeClientPayment } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string; pid: string }> };

/** The browser returns the provider's proof; it is verified server-side (signature) before anything is marked paid. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "billing:manage");
  const { data } = await readJson(req, z.object({ data: z.record(z.string().max(60), z.string().max(500)) }));
  return ok({ invoice: await completeClientPayment(access, ids.pid, data) });
});
