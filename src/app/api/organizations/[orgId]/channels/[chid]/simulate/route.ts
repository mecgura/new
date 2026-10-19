import { handle, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { orgRoute } from "@/lib/route-helpers";
import { channelSimulateSchema } from "@/lib/validations";
import { receiveChannelMessage } from "@/services/channels/inbound";
import { randomUUID } from "node:crypto";

type Ctx = { params: Promise<{ orgId: string; chid: string }> };

/** Demo inboxes only: pretend a customer emailed in, to try the inbox without any provider. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  const input = await readJson(req, channelSimulateSchema);
  const account = await db.channelAccount.findFirst({ where: { id: ids.chid, organizationId: access.organizationId, kind: "email", status: "demo" } });
  if (!account) throw new ApiError("VALIDATION_ERROR", "Customer emails can only be simulated on a demo email inbox.");
  const r = await receiveChannelMessage(account, { identityKind: "email", identityValue: input.from, name: input.name, subject: input.subject, body: input.body, externalId: `demo.in.${randomUUID()}`, at: new Date() });
  return ok(r, { status: 201 });
});
