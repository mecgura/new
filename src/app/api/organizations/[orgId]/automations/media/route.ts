import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { uploadAutomationMedia } from "@/services/automations/media";

type Ctx = { params: Promise<{ orgId: string }> };
const schema = z.object({ filename: z.string().trim().max(200).default(""), data: z.string().min(10).max(4_400_000) }).strict();

/** Upload an image (JPG/PNG) or brochure (PDF) for an automation message. Returns the link to put on the message. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:manage");
  const input = await readJson(req, schema);
  return ok({ media: await uploadAutomationMedia(access, input, req) }, { status: 201 });
});
