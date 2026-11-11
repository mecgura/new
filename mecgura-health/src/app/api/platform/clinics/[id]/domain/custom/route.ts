import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { disableCustomDomain, setCustomDomain, clinicDomain } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => clinicDomain(ctx, params.id));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => setCustomDomain(ctx, params.id, ((await readJson(req)) as { customDomain?: string | null }).customDomain ?? null));
export const DELETE = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => disableCustomDomain(ctx, params.id, ((await readJson(req).catch(() => ({}))) as { password?: string }).password));
