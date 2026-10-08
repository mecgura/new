import { apiRoute, readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/auth/context";
import { adminAct } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
const ACTS = ["suspend", "reactivate", "pause", "unpause", "cancel", "expire"] as const;
/** { act: suspend|reactivate|pause|unpause|cancel|expire, reason, password } — every action is re-authenticated, reasoned and audited. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => {
  const b = (await readJson(req)) as { act?: string; reason?: string; password?: string; extendDays?: number };
  if (!(ACTS as readonly string[]).includes(b.act ?? "")) throw new AppError("VALIDATION_ERROR", { message: "Unknown action." });
  await adminAct(ctx, params.tenantId, b.act as (typeof ACTS)[number], b); return { done: true };
});
