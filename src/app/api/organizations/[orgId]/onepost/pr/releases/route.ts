import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listReleases } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string }> };
export const GET = handle<Ctx>(async (req, { params }) => ok(await listReleases((await orgRoute(req, params, "onepost:read")).access)));
