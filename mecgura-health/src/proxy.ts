import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { buildCsp } from "@/lib/security/csp";
import { isPublicSitePath } from "@/lib/website/paths";
import { parseTenantHost } from "@/lib/tenant/host";

// Paths reachable without a session.
const PUBLIC_PATHS = ["/login", "/invite", "/robots.txt"];

/**
 * Runs before every page request (API routes and static assets are excluded in `config`).
 *  1. Sets a fresh nonce-based Content-Security-Policy.
 *  2. Optimistic auth gate: no valid session cookie => /login. This is a convenience only —
 *     the real checks (user still active, permissions, tenant) happen server-side in
 *     lib/auth/context.ts on every page and API call.
 */
export async function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development", upgrade: (process.env.APP_URL ?? "").startsWith("https://") });

  const { pathname } = req.nextUrl;

  // Public clinic website: on a clinic's own host (subdomain / custom domain) the public paths are served by the
  // site renderer. The tenant itself is resolved from the HOST on the server — the path never names a tenant.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (parseTenantHost(host, process.env.TENANT_ROOT_DOMAIN) && isPublicSitePath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `/site${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    headers.set("x-mh-site", "1");
    const res = NextResponse.rewrite(url, { request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET });
    if (!token) {
      const url = new URL("/login", req.nextUrl.origin);
      if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
      const redirect = NextResponse.redirect(url);
      redirect.headers.set("Content-Security-Policy", csp);
      return redirect;
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Prefetch requests are NOT excluded: on a clinic's own host they must be rewritten to the public site like any other
  // request, otherwise every <Link> prefetch would 404.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
