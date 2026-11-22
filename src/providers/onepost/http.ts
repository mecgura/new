import { PublishError, retryableStatus } from "@/lib/onepost-publish";

export type HttpResult<T> = { status: number; json: T; headers: Headers };

const messageOf = (json: unknown, fallback: string) => {
  const j = json as { message?: string; error?: string | { message?: string; status?: string }; error_description?: string; code?: string } | null;
  const e = j?.error;
  return (typeof e === "string" ? e : e?.message) || j?.error_description || j?.message || fallback;
};

/**
 * One timeout-bounded request. Network failures and 408/429/5xx are "retryable" (tried again later); 401 means the connection must be renewed;
 * every other error is final and its text is shown to the person as the reason.
 */
export async function http<T = unknown>(url: string | URL, init: RequestInit & { timeoutMs?: number; label: string }): Promise<HttpResult<T>> {
  const { timeoutMs = 30_000, label, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new PublishError(`${label} did not respond (network or timeout).`, true);
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text.slice(0, 200) };
    }
  }
  if (res.status >= 300 && res.status < 400) throw new PublishError(`${label} redirected the request, which isn't allowed.`, false);
  if (!res.ok) {
    const msg = `${label}: ${messageOf(json, `HTTP ${res.status}`)}`.slice(0, 300);
    throw new PublishError(msg, retryableStatus(res.status), res.status === 401);
  }
  return { status: res.status, json: json as T, headers: res.headers };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
