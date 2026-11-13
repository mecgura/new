import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getSheetsLink, sendTestRow, setSheetsLink } from "@/services/integrations/sheets";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:read");
  return ok(await getSheetsLink(access.organizationId));
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:manage");
  const { url } = await readJson(req, z.object({ url: z.string().max(300) }));
  return ok(await setSheetsLink(access.organizationId, url));
});

/** Sends one test row to the sheet. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:manage");
  return ok(await sendTestRow(access.organizationId));
});
