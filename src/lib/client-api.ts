// Small fetch helper for client components: parses the standard API error shape.
export type ApiFailure = { ok: false; status: number; error: string; details?: Record<string, string[]> };
export type ApiSuccess<T> = { ok: true; data: T };

export async function apiFetch<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiSuccess<T> | ApiFailure> {
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const j = json as { error?: string; details?: Record<string, string[]> };
      return { ok: false, status: res.status, error: j.error ?? "Something went wrong. Please try again.", details: j.details };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Network error — check your connection and try again." };
  }
}
