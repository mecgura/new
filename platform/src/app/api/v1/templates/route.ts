import { ok } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiTemplates } from "@/services/api/public";

export const GET = apiHandle("templates:read", async (_req, _ctx, p) => ok(await apiTemplates(p)));
