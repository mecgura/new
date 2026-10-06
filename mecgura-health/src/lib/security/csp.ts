/** Builds the per-request Content-Security-Policy (nonce-based scripts, no inline script). */
export function buildCsp(nonce: string, opts: { isDev: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ""}`,
    // Style attributes (progress bars, tenant colour variables) need inline styles; scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    `connect-src 'self'${opts.isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}
