import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { queueSnapshot, registerVisit } from "@/lib/services/opd";

export const dynamic = "force-dynamic";
/** Polled by the live queue screens. Send ?etag=<last etag> to get { notModified: true } instead of the whole queue. */
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  return queueSnapshot(ctx, { doctorUserId: sp.get("doctorUserId") ?? undefined, etag: sp.get("etag") ?? undefined });
});
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "opd.manage" }, async ({ req, ctx }) => registerVisit(ctx, await readJson(req)));
