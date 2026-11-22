import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactSchema, createContact, listContacts } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => ok(await listContacts((await orgRoute(req, params, "onepost:read")).access)));
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:publish");
  return ok(await createContact(access, await readJson(req, contactSchema), req), { status: 201 });
});
