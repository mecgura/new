import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { conversationListSchema, startConversationSchema } from "@/lib/validations";
import { getConversation, listConversations } from "@/services/inbox/conversations";
import { startConversation } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  const q = readQuery(req, conversationListSchema);
  return ok({ ...(await listConversations(access, { ...q, accountId: q.accountId || undefined, tagId: q.tagId || undefined })), page: q.page, pageSize: q.pageSize });
});

/** Start (or open the existing) conversation with a contact on one of the org's numbers. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:reply");
  const { contactId, whatsappAccountId } = await readJson(req, startConversationSchema);
  const id = await startConversation(access, contactId, whatsappAccountId);
  return ok({ conversation: await getConversation(access, id) }, { status: 201 });
});
