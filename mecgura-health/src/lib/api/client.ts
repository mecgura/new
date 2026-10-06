import { ERROR_CODES, type ApiResult } from "@/lib/errors";

/**
 * Browser-side fetch helper. Always resolves to an ApiResult — network failures and
 * non-JSON responses become structured errors instead of thrown exceptions.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(input, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (body && typeof body === "object" && "ok" in body) return body;
    return { ok: false, error: { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message } };
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: ERROR_CODES.NETWORK_ERROR.message } };
  }
}
