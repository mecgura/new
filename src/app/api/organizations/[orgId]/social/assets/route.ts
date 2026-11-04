import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { MAX_MEDIA_BYTES } from "@/services/social/posts";
import { addAsset, listAssets } from "@/services/social/assets";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ q: z.string().trim().max(60).default("") });
const body = z.object({ name: z.string().trim().max(120).default("Image"), image: z.string().max(Math.ceil(MAX_MEDIA_BYTES * 1.4)), tags: z.string().max(200).optional() });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  return ok(await listAssets(access, readQuery(req, query).q));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  return ok({ asset: await addAsset(access, await readJson(req, body)) }, { status: 201 });
});
