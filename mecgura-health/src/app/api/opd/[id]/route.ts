import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { queueAction } from "@/lib/services/opd";

export const dynamic = "force-dynamic";
/** Body: { action: "call" | "start" | "hold" | "resume" | "requeue" | "skip" | "complete" | "cancel" | "recall" | "priority" | "reassign", ... } */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => queueAction(ctx, params.id, await readJson(req)));
