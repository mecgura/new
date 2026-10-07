import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { appointmentUpdateSchema } from "@/lib/validations";
import { updateAppointment } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; apid: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "appointments:manage");
  const input = await readJson(req, appointmentUpdateSchema);
  return ok({ appointment: await updateAppointment(access, ids.apid, input, req) });
});
