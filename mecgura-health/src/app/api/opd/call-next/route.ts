import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { callNext } from "@/lib/services/opd";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => {
  const b = (await readJson(req)) as { doctorUserId?: string };
  return callNext(ctx, typeof b.doctorUserId === "string" ? b.doctorUserId : undefined);
});
