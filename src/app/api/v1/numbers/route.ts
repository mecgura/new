import { ok } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiNumbers } from "@/services/api/public";

export const GET = apiHandle("numbers:read", async (_req, _ctx, p) => ok(await apiNumbers(p)));
