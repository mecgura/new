import { handle, ok, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { profileSchema } from "@/lib/validations";
import { updateProfile } from "@/lib/services/accounts";

export const PATCH = handle(async (req) => {
  const user = await requireUser();
  const { name } = await readJson(req, profileSchema);
  return ok({ user: await updateProfile(user.id, name, req) });
});
