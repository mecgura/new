import { apiRoute, readJson } from "@/lib/api/handler";
import { acceptInvitation } from "@/lib/services/users";
import { parseOrThrow } from "@/lib/validation";
import { inviteAcceptSchema } from "@/lib/validation/clinic";

/** Public (the invitation token IS the credential). Rate limited, generic failure message. */
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => {
  const input = parseOrThrow(inviteAcceptSchema, await readJson(req));
  return acceptInvitation(input.token, input.password);
});
