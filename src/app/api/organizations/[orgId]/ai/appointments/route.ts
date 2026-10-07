import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { listAppointments } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string }> };

const query = paginationSchema.extend({ status: z.enum(["", "requested", "confirmed", "cancelled", "completed"]).optional().default("") });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ai:read");
  const q = readQuery(req, query);
  return ok(await listAppointments(access.organizationId, { ...q, status: q.status || undefined }));
});
