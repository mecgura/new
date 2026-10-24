import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { paginationSchema } from "@/lib/validations";
import { allAgreements } from "@/services/agreements/agreements";

const query = paginationSchema.extend({ status: z.enum(["", "draft", "sent", "signed", "superseded", "void"]).optional().default("") });

/** Every client's agreements, for the Admin → Agreements list. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await allAgreements(readQuery(req, query)));
});
