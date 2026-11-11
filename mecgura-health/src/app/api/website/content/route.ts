import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseOrThrow } from "@/lib/validation";
import { sectionSchema } from "@/lib/validation/website";
import { getDraft, saveSection } from "@/lib/services/website-content";

export const dynamic = "force-dynamic";

export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.view" }, async ({ ctx }) => {
  const { draft, hasUnpublishedChanges } = await getDraft(ctx);
  return { draft, hasUnpublishedChanges };
});

/** Body: { section, data } — saves one section of the DRAFT only. */
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.edit" }, async ({ req, ctx }) => {
  const { section, data } = parseOrThrow(sectionSchema, await readJson(req));
  return { content: await saveSection(ctx, section, data) };
});
