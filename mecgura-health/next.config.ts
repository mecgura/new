import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Static security headers. The nonce-based Content-Security-Policy is set per
// request in src/proxy.ts (it needs a fresh nonce for every response).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets CI / local checks build into a separate folder while `next dev` is running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // Dev only: lets the e2e suite open clinic subdomains such as demo-b.mecgura.test against `next dev`.
  allowedDevOrigins: ["*.mecgura.test"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
