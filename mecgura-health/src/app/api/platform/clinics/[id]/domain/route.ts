import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { confirmDomainManually } from "@/lib/services/platform-clinics";
import { markDomainVerified, updateDomain } from "@/lib/services/clinics";
import { parseOrThrow } from "@/lib/validation";
import { domainSchema } from "@/lib/validation/clinic";

export const PATCH = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) =>
  updateDomain(ctx, params.id, parseOrThrow(domainSchema, await readJson(req))),
);

/** Manual confirmation that DNS + SSL were set up outside the app. Confirming needs a reason and the Super Admin's own password; un-verifying does not. Prefer POST …/domain/verify (a real DNS check). */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) => {
  const b = parseOrThrow(z.object({ verified: z.boolean(), password: z.string().max(200).optional(), notes: z.string().max(500).optional() }), await readJson(req));
  return b.verified ? confirmDomainManually(ctx, params.id, b) : markDomainVerified(ctx, params.id, false);
});
