import { ok, readQuery } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiMessagesListSchema } from "@/lib/api-public";
import { idSchema } from "@/lib/validations";
import { apiListMessages } from "@/services/api/public";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandle<Ctx>("messages:read", async (req, { params }, p) => ok(await apiListMessages(p, idSchema.parse((await params).id), readQuery(req, apiMessagesListSchema))));
