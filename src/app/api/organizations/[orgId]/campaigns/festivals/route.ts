import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { createFestivalCampaign, createFestivalTemplate, festivalPlanner } from "@/services/campaigns/festival";

type Ctx = { params: Promise<{ orgId: string }> };

/** Upcoming festivals with this workspace's greeting template and campaign for each. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  return ok(await festivalPlanner(access));
});

const id = z.string().trim().min(1).max(64);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("template"), festivalId: id, wabaId: id, businessName: z.string().trim().max(60).default(""), offer: z.string().trim().max(300).default("") }).strict(),
  z.object({ action: z.literal("campaign"), festivalId: id, whatsappAccountId: id }).strict(),
]);

export const POST = handle<Ctx>(async (req, { params }) => {
  // Owners and managers hold both campaigns:manage and templates:manage.
  const { access } = await orgRoute(req, params, "campaigns:manage");
  const input = await readJson(req, schema);
  if (input.action === "template") return ok(await createFestivalTemplate(access, input, req), { status: 201 });
  return ok(await createFestivalCampaign(access, input, req), { status: 201 });
});
