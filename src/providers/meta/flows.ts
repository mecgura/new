import { getMetaConfig } from "@/providers/meta/config";
import { graph, MetaApiError } from "@/providers/meta/graph";

export type FlowValidationError = { error?: string; error_type?: string; message?: string; line_start?: number; pointers?: unknown[] };

/** Creates a Flow on the WABA with its JSON in one call (not published). */
export async function createFlow(wabaId: string, token: string, input: { name: string; category: string; flowJson: string }) {
  return graph<{ id: string; success?: boolean; validation_errors?: FlowValidationError[] }>(`${wabaId}/flows`, {
    token,
    method: "POST",
    body: { name: input.name, categories: [input.category], flow_json: input.flowJson },
    timeoutMs: 30_000,
  });
}

/** Replaces a draft Flow's JSON (multipart asset upload). */
export async function updateFlowJson(metaFlowId: string, token: string, flowJson: string): Promise<{ validation_errors?: FlowValidationError[] }> {
  const { graphVersion } = getMetaConfig();
  const form = new FormData();
  form.set("name", "flow.json");
  form.set("asset_type", "FLOW_JSON");
  form.set("file", new Blob([flowJson], { type: "application/json" }), "flow.json");
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${graphVersion}/${metaFlowId}/assets`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new MetaApiError("Couldn't reach Meta to upload the Flow.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { validation_errors?: FlowValidationError[]; error?: { message?: string } };
  if (!res.ok) throw new MetaApiError(data.error?.message ?? "Meta rejected the Flow JSON.", res.status);
  return data;
}

export const publishFlow = (metaFlowId: string, token: string) => graph<{ success?: boolean }>(`${metaFlowId}/publish`, { token, method: "POST" });
export const deprecateFlow = (metaFlowId: string, token: string) => graph<{ success?: boolean }>(`${metaFlowId}/deprecate`, { token, method: "POST" });
export const deleteDraftFlow = (metaFlowId: string, token: string) => graph<{ success?: boolean }>(metaFlowId, { token, method: "DELETE" });
