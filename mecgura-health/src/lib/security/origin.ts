/**
 * CSRF defence for cookie-authenticated, state-changing API routes: the request's
 * Origin (or Referer) must match the Host the app is served on. Server Actions and
 * Auth.js endpoints already perform their own checks.
 */
export function isSameOrigin(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
