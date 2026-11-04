import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { importWebsite, MAX_CRAWL_PAGES } from "@/services/ai/studio";

export const maxDuration = 60;

type Ctx = { params: Promise<{ orgId: string; aid: string }> };
const schema = z.object({ url: z.string().trim().url("Enter a full link, like https://yourshop.in").max(2000), maxPages: z.number().int().min(1).max(MAX_CRAWL_PAGES).default(10) });

/** Reads several pages of one public website (respecting robots.txt) into the knowledge base. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  enforceRateLimit(`ai-crawl:${access.organizationId}`, 5, 3_600_000);
  const { url, maxPages } = await readJson(req, schema);
  return ok(await importWebsite(access, ids.aid, url, maxPages, req), { status: 201 });
});
