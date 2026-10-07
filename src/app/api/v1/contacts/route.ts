import { ok, readJson, readQuery } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiContactCreateSchema, apiContactListSchema } from "@/lib/api-public";
import { apiCreateContact, apiListContacts } from "@/services/api/public";

export const GET = apiHandle("contacts:read", async (req, _ctx, p) => ok(await apiListContacts(p, readQuery(req, apiContactListSchema))));

export const POST = apiHandle("contacts:write", async (req, _ctx, p) => ok(await apiCreateContact(p, await readJson(req, apiContactCreateSchema), req), { status: 201 }));
