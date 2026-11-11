import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { changeLifecycle } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
/** Body: { action: activate|suspend|deactivate|archive|restore, category?, notes?, password? } */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => changeLifecycle(ctx, params.id, (await readJson(req)) as { action: string; category?: string; notes?: string; password?: string }));
