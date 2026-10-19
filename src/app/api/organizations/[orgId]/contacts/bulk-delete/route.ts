import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { bulkDeleteContactsSchema } from "@/lib/validations";
import { deleteContacts } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string }> };

/** Permanently deletes contacts: either the ids given, or everything matching the filters (with the count the user saw). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:delete");
  enforceRateLimit(`bulk-delete:${access.user.id}`, 20, 60 * 60_000);
  const input = await readJson(req, bulkDeleteContactsSchema);
  const ctx = { organizationId: access.organizationId, actorUserId: access.user.id, req };
  if ("ids" in input) return ok(await deleteContacts(ctx, { ids: input.ids }));
  const f = input.filter;
  return ok(await deleteContacts(ctx, { filter: { tab: f.tab, q: f.q, tagId: f.tagId || undefined, leadStatus: f.leadStatus || undefined, ownerUserId: f.ownerUserId || undefined }, expectedCount: input.expectedCount }));
});
