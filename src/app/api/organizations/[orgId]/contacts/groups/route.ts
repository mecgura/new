import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { contactGroupSchema } from "@/lib/validations";
import { groupContacts } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string }> };

/** Adds contacts to a group (tag), or removes them: the ids given, or everything matching the filters. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:write");
  enforceRateLimit(`contact-groups:${access.user.id}`, 60, 60 * 60_000);
  const input = await readJson(req, contactGroupSchema);
  const ctx = { organizationId: access.organizationId, actorUserId: access.user.id, req };
  const base = { group: input.group, action: input.action };
  if ("ids" in input) return ok(await groupContacts(ctx, { ids: input.ids, ...base }));
  const f = input.filter;
  return ok(await groupContacts(ctx, { filter: { tab: f.tab, q: f.q, tagId: f.tagId || undefined, leadStatus: f.leadStatus || undefined, ownerUserId: f.ownerUserId || undefined }, expectedCount: input.expectedCount, ...base }));
});
