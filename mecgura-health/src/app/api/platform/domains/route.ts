import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listDomains } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => listDomains(ctx, { q: sp(req).get("q") ?? undefined, status: sp(req).get("status") ?? undefined, page: Number(sp(req).get("page")) || 1 }));
