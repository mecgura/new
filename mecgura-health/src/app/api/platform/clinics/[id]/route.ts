import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { getClinic, updateClinic } from "@/lib/services/clinics";
import { parseOrThrow } from "@/lib/validation";
import { clinicProfileSchema } from "@/lib/validation/clinic";

export const dynamic = "force-dynamic";

export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => getClinic(ctx, params.id));

export const PATCH = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) =>
  updateClinic(ctx, params.id, parseOrThrow(clinicProfileSchema, await readJson(req))),
);
