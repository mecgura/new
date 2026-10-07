import { ok, readJson } from "@/lib/api";
import { apiHandle } from "@/lib/api-auth";
import { apiContactUpdateSchema } from "@/lib/api-public";
import { idSchema } from "@/lib/validations";
import { apiGetContact, apiUpdateContact } from "@/services/api/public";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandle<Ctx>("contacts:read", async (_req, { params }, p) => ok(await apiGetContact(p, idSchema.parse((await params).id))));

export const PATCH = apiHandle<Ctx>("contacts:write", async (req, { params }, p) => ok(await apiUpdateContact(p, idSchema.parse((await params).id), await readJson(req, apiContactUpdateSchema), req)));
