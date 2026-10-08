import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { searchUsers } from "@/lib/services/platform-users";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => { const s = sp(req); const g = (k: string) => s.get(k) ?? undefined; return searchUsers(ctx, { q: g("q"), role: g("role"), tenantId: g("tenantId"), status: g("status"), page: Number(s.get("page")) || 1 }); });
