import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { setGlobalMaintenance } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => setGlobalMaintenance(ctx, (await readJson(req)) as { enabled: boolean; message?: string; password?: string }));
