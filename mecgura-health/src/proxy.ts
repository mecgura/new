import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { buildCsp } from "@/lib/security/csp";

// Paths reachable without a session.
const PUBLIC_PATHS = ["/login"];

/**
 * Runs before every page request (API routes and static assets are excluded in `config`).
 *  1. Sets a fresh nonce-based Content-Security-Policy.
 *  2. Optimistic auth gate: no valid session cookie => /login. This is a convenience only —
 *     the real checks (user still active, permissions, tenant) happen server-side in
 *     lib/auth/context.ts on every page and API call.
 */
export async function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  const { pathname } = req.nextUrl;
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
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
