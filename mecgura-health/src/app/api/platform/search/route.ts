import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminSearch } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => adminSearch(ctx, sp(req).get("q") ?? ""));
