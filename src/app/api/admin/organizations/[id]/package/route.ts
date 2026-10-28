import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { grantCredits, grantSchema, packageStatus, type PackageStatus } from "@/services/billing/package";

type Ctx = { params: Promise<{ id: string }> };
const dto = (s: PackageStatus) => ({ ...s, marketing: { ...s.marketing, remaining: Number.isFinite(s.marketing.remaining) ? s.marketing.remaining : -1 }, utility: { ...s.utility, remaining: Number.isFinite(s.utility.remaining) ? s.utility.remaining : -1 } });

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ package: dto(await packageStatus(idSchema.parse((await params).id))) });
});

/** Add (or take back, with a negative number) top-up credits by hand. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  return ok({ package: dto(await grantCredits(id, await readJson(req, grantSchema), admin.id, req)) });
});
