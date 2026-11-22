import { siteConfig } from "@/config/site";
import { toErrorResponse } from "@/lib/api";
import { isOAuthProvider } from "@/lib/onepost-publish";
import { completeOAuth } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ provider: string }> };

const back = (query: Record<string, string>) => Response.redirect(`${siteConfig.url}/onepost?${new URLSearchParams({ tab: "connections", ...query })}`, 302);

/** LinkedIn and Google send the person back here. The one-time state ties the sign-in to the person and workspace that started it. */
export async function GET(req: Request, { params }: Ctx) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) return Response.redirect(`${siteConfig.url}/onepost`, 302);
  const url = new URL(req.url);
  try {
    const r = await completeOAuth(provider, { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") }, req);
    return back(r.ok ? { connected: provider, message: r.message } : { error: r.message });
  } catch (e) {
    const res = toErrorResponse(e);
    if (res.status === 401) return Response.redirect(`${siteConfig.url}/login`, 302);
    return back({ error: res.status === 403 ? "Only the workspace owner can connect accounts." : "Could not finish connecting. Please try again." });
  }
}
