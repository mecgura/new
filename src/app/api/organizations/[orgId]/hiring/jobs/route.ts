import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { jobSchema, listJobs, saveJob } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ats:manage");
  return ok(await listJobs(access));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ats:manage");
  return ok({ job: await saveJob(access, null, await readJson(req, jobSchema), req) }, { status: 201 });
});
