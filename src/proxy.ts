import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isSuperAdmin } from "@/lib/authz";

const APP_PREFIXES = ["/dashboard", "/settings", "/whatsapp", "/inbox", "/contacts", "/team", "/templates", "/campaigns", "/automations", "/flows", "/ai", "/webhooks", "/billing", "/analytics"];
const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);


// First line of defence only: verifies the Auth.js JWT cookie without touching
// the database. Every protected page/layout and API route re-checks the user,
// role and tenant against the DB (lib/session.ts) — never rely on this alone.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdmin = matches(pathname, "/admin");
  // "/api" is the developer page itself; everything under /api/… is a route handler with its own authentication.
  const isApp = APP_PREFIXES.some((p) => matches(pathname, p)) || pathname === "/api";
  if (!isAdmin && !isApp) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  if (!token?.id) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (isAdmin && !isSuperAdmin(token.role)) {
    const url = new URL("/dashboard", req.nextUrl.origin);
    url.searchParams.set("denied", "admin");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Every page except API routes (they authenticate themselves), Next internals and files with an extension (icons, manifest…).
// "/api" with no trailing path is the developer page and is matched on purpose.
export const config = { matcher: ["/((?!api/|_next/|.*\\..*).*)"] };
