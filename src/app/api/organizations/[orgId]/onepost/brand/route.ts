import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { brandInputSchema, getBrand, saveBrand } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  return ok({ brand: await getBrand(access) });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:brand");
  return ok({ brand: await saveBrand(access, await readJson(req, brandInputSchema), req) });
});
