import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { changeClinicAdmin } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => changeClinicAdmin(ctx, params.id, (await readJson(req)) as { userId: string; demotePreviousTo?: string; password?: string; notes?: string }));
