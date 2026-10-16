import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { auditCenter } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => {
  const s = sp(req); const g = (k: string) => s.get(k) ?? undefined;
  return auditCenter(ctx, { actorId: g("actorId"), tenantId: g("tenantId"), action: g("action"), category: g("category"), severity: g("severity"), from: g("from"), to: g("to"), entityType: g("entityType"), entityId: g("entityId"), page: Number(s.get("page")) || 1 });
});
