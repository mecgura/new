import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { MAX_LOGO_BYTES } from "@/lib/onepost";
import { orgRoute } from "@/lib/route-helpers";
import { clearLogo, logoFile, setLogo } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string }> };
const body = z.object({ image: z.string().max(Math.ceil(MAX_LOGO_BYTES * 1.4) + 64) });

/** The logo image, for team members only. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  const f = await logoFile(access);
  return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:brand");
  return ok({ brand: await setLogo(access, (await readJson(req, body)).image, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:brand");
  await clearLogo(access, req);
  return ok({ ok: true });
});
