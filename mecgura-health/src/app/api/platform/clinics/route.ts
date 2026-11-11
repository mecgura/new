import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { createClinic } from "@/lib/services/clinics";
import { listClinicsAdmin } from "@/lib/services/platform-clinics";
import { parseOrThrow } from "@/lib/validation";
import { clinicCreateSchema } from "@/lib/validation/clinic";

export const dynamic = "force-dynamic";

export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  return listClinicsAdmin(ctx, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, type: sp.get("type") ?? undefined, page: Number(sp.get("page")) || 1, sort: sp.get("sort") ?? undefined, includeArchived: sp.get("all") === "1" });
});

export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx }) =>
  createClinic(ctx, parseOrThrow(clinicCreateSchema, await readJson(req))),
);
