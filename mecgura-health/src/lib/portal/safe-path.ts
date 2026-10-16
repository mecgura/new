/** Only same-site paths INSIDE the portal are valid post-login destinations. */
export const safePortalPath = (v: unknown, fallback = "/portal/dashboard") => (typeof v === "string" && /^\/portal(\/[A-Za-z0-9._~/?=&%-]*)?$/.test(v) && !v.includes("//") && !/^\/portal\/(login|activate|register|forgot)/.test(v) ? v : fallback);
