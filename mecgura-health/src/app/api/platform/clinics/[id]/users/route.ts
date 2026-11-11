import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { clinicUsers, inviteClinicUser } from "@/lib/services/platform-users";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => clinicUsers(ctx, params.id, { q: sp(req).get("q") ?? undefined, page: Number(sp(req).get("page")) || 1 }));
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => inviteClinicUser(ctx, params.id, (await readJson(req)) as { name: string; email: string; phone?: string; role: string }));
