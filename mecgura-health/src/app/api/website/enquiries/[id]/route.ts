import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseOrThrow } from "@/lib/validation";
import { enquiryStatusSchema } from "@/lib/validation/website";
import { setEnquiryStatus } from "@/lib/services/enquiries";

export const PATCH = apiRoute<TenantRequestContext>({ tenant: true, permission: "enquiries.manage" }, async ({ req, ctx, params }) =>
  setEnquiryStatus(ctx, params.id, parseOrThrow(enquiryStatusSchema, await readJson(req)).status),
);
