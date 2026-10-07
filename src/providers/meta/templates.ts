import { getMetaConfig } from "@/providers/meta/config";
import { graph, MetaApiError } from "@/providers/meta/graph";

/** Template as returned by GET /{waba-id}/message_templates. */
export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Record<string, unknown>[];
  rejected_reason?: string;
  quality_score?: { score?: string };
};

const FIELDS = "id,name,language,status,category,components,rejected_reason,quality_score";

/** Submits a template for Meta review. Meta may answer APPROVED immediately or PENDING. */
export async function createTemplate(wabaId: string, token: string, input: { name: string; language: string; category: string; components: Record<string, unknown>[] }) {
  return graph<{ id: string; status?: string; category?: string }>(`${wabaId}/message_templates`, {
    token,
    method: "POST",
    body: { name: input.name, language: input.language, category: input.category, components: input.components },
    timeoutMs: 30_000,
  });
}

/** All templates on the WABA (follows paging, capped for safety). */
export async function listTemplates(wabaId: string, token: string, max = 1000): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let after: string | undefined;
  do {
    const r = await graph<{ data?: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${wabaId}/message_templates`, {
      token,
      query: { fields: FIELDS, limit: "100", ...(after ? { after } : {}) },
    });
    out.push(...(r.data ?? []));
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
  } while (after && out.length < max);
  return out;
}

/** Deletes one language version (hsm_id) of a template. */
export async function deleteTemplate(wabaId: string, token: string, name: string, metaTemplateId: string) {
  return graph<{ success?: boolean }>(`${wabaId}/message_templates`, { token, method: "DELETE", query: { name, hsm_id: metaTemplateId } });
}

/**
 * Media headers need a sample for review. Meta takes it through the
 * Resumable Upload API (app-scoped) and returns a handle for `header_handle`.
 */
export async function uploadReviewSample(token: string, file: Blob, filename: string, mimeType: string): Promise<string> {
  const { appId, graphVersion } = getMetaConfig();
  if (!appId) throw new MetaApiError("META_APP_ID is not configured, so a sample file can't be uploaded for review.", 0);
  const session = await graph<{ id?: string }>(`${appId}/uploads`, {
    token,
    method: "POST",
    query: { file_name: filename, file_length: String(file.size), file_type: mimeType },
  });
  if (!session.id) throw new MetaApiError("Meta didn't open an upload session.", 502);
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${graphVersion}/${session.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
      body: file,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new MetaApiError("Couldn't reach Meta to upload the sample.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { h?: string; error?: { message?: string } };
  if (!res.ok || !data.h) throw new MetaApiError(data.error?.message ?? "Meta rejected the sample file.", res.status);
  return data.h;
}
