import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { featureMatrix } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => featureMatrix(ctx, { q: sp(req).get("q") ?? undefined, page: Number(sp(req).get("page")) || 1 }));
