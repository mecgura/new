import { getMetaConfig } from "@/providers/meta/config";

/** Error returned by the Graph API (message is Meta's user-facing text, safe to show). */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

type GraphOptions = {
  token?: string;
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

/**
 * Thin, timeout-bounded Graph API client. Tokens go in the Authorization header,
 * never in the URL, so they can't leak into proxy/access logs.
 */
export async function graph<T>(path: string, opts: GraphOptions = {}): Promise<T> {
  const { graphVersion } = getMetaConfig();
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      cache: "no-store",
    });
  } catch {
    throw new MetaApiError("Couldn't reach Meta. Please try again in a moment.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new MetaApiError(e.message ?? `Meta returned HTTP ${res.status}`, res.status, e.code, e.error_subcode, e.fbtrace_id);
  }
  return data as T;
}
