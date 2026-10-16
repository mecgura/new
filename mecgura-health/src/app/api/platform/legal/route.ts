import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { getLegal, saveLegal } from "@/lib/services/legal";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async () => ({ terms: await getLegal("terms"), privacy: await getLegal("privacy") }));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => saveLegal(ctx, await readJson(req)));
