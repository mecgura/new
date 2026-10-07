import { ok, readQuery } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiListSchema } from "@/lib/api-public";
import { apiListConversations } from "@/services/api/public";

export const GET = apiHandle("conversations:read", async (req, _ctx, p) => ok(await apiListConversations(p, readQuery(req, apiListSchema))));
