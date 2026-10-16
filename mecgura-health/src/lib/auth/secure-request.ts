/** True when the browser reached us over https (directly, or through Vercel/another proxy that sets x-forwarded-proto). */
export function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  return url.startsWith("https:") || (forwardedProto ?? "").split(",")[0].trim().toLowerCase() === "https";
}
