import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { importWebsitePage } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

const schema = z.object({ url: z.string().trim().url("Enter a full link, like https://yourshop.in/menu").max(2000) });

/** Reads a public web page and saves its text as a knowledge document. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  enforceRateLimit(`ai-import:${access.organizationId}`, 20, 3_600_000);
  const { url } = await readJson(req, schema);
  return ok({ document: await importWebsitePage(access, ids.aid, url, req) }, { status: 201 });
});
