import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { markDomainVerified, updateDomain } from "@/lib/services/clinics";
import { parseOrThrow } from "@/lib/validation";
import { domainSchema } from "@/lib/validation/clinic";

export const PATCH = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) =>
  updateDomain(ctx, params.id, parseOrThrow(domainSchema, await readJson(req))),
);

/** Body: { verified: boolean } — Super Admin confirms DNS + SSL were set up outside the app. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) =>
  markDomainVerified(ctx, params.id, parseOrThrow(z.object({ verified: z.boolean() }), await readJson(req)).verified),
);
