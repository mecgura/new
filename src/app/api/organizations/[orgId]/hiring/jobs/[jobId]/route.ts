import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteJob, jobSchema, saveJob } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string; jobId: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  return ok({ job: await saveJob(access, ids.jobId, await readJson(req, jobSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  await deleteJob(access, ids.jobId, req);
  return ok({ deleted: true });
});
