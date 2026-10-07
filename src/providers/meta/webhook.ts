import { hmacSha256Hex, safeEqual } from "@/lib/crypto";

/** Verifies Meta's X-Hub-Signature-256 ("sha256=<hex>") against any of the candidate app secrets. */
export function verifySignature(rawBody: Buffer, header: string | null, appSecrets: string[]): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = header.slice(7);
  return appSecrets.filter(Boolean).some((secret) => safeEqual(hmacSha256Hex(secret, rawBody), received));
}

export type MetaWebhookChange = { field: string; value: Record<string, unknown> };
export type MetaWebhookPayload = { object?: string; entry?: { id?: string; time?: number; changes?: MetaWebhookChange[] }[] };

export type NormalizedEvent =
  | { kind: "message"; wabaId: string; phoneNumberId: string; id: string; from: string; type: string; timestamp: string; profileName: string; raw: Record<string, unknown> }
  | { kind: "status"; wabaId: string; phoneNumberId: string; id: string; status: string; recipient: string; timestamp: string; error: string }
  | { kind: "quality"; wabaId: string; displayPhoneNumber: string; event: string; currentLimit: string }
  | { kind: "template_status"; wabaId: string; metaTemplateId: string; name: string; language: string; event: string; reason: string }
  | { kind: "template_quality"; wabaId: string; metaTemplateId: string; score: string }
  | { kind: "template_category"; wabaId: string; metaTemplateId: string; category: string }
  | { kind: "account"; wabaId: string; event: string; detail: string }
  | { kind: "other"; wabaId: string; field: string };

/** Flattens Meta's entry/changes envelope into typed events (unknown fields are kept as "other"). */
export function normalizeEvents(payload: MetaWebhookPayload): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const wabaId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === "messages") {
        const meta = (v.metadata ?? {}) as { phone_number_id?: string };
        const phoneNumberId = String(meta.phone_number_id ?? "");
        const profiles = (v.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
        for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
          const from = String(m.from ?? "");
          const profileName = profiles.find((c) => c.wa_id === from)?.profile?.name ?? "";
          out.push({ kind: "message", wabaId, phoneNumberId, id: String(m.id ?? ""), from, type: String(m.type ?? ""), timestamp: String(m.timestamp ?? ""), profileName, raw: m });
        }
        for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
          const errors = (s.errors as { title?: string; message?: string }[] | undefined) ?? [];
          out.push({ kind: "status", wabaId, phoneNumberId, id: String(s.id ?? ""), status: String(s.status ?? ""), recipient: String(s.recipient_id ?? ""), timestamp: String(s.timestamp ?? ""), error: errors[0]?.message ?? errors[0]?.title ?? "" });
        }
      } else if (change.field === "phone_number_quality_update") {
        out.push({ kind: "quality", wabaId, displayPhoneNumber: String(v.display_phone_number ?? ""), event: String(v.event ?? ""), currentLimit: String(v.current_limit ?? "") });
      } else if (change.field === "message_template_status_update") {
        out.push({
          kind: "template_status",
          wabaId,
          metaTemplateId: String(v.message_template_id ?? ""),
          name: String(v.message_template_name ?? ""),
          language: String(v.message_template_language ?? ""),
          event: String(v.event ?? ""),
          reason: String(v.reason ?? ""),
        });
      } else if (change.field === "message_template_quality_update") {
        out.push({ kind: "template_quality", wabaId, metaTemplateId: String(v.message_template_id ?? ""), score: String(v.new_quality_score ?? "") });
      } else if (change.field === "template_category_update") {
        out.push({ kind: "template_category", wabaId, metaTemplateId: String(v.message_template_id ?? ""), category: String(v.new_category ?? "") });
      } else if (change.field === "account_update" || change.field === "account_review_update") {
        const info = (v.ban_info ?? v.violation_info ?? v.restriction_info ?? {}) as Record<string, unknown>;
        out.push({
          kind: "account",
          wabaId,
          event: String(v.event ?? v.decision ?? change.field),
          detail: String(info.waba_ban_state ?? info.violation_type ?? (Array.isArray(v.restriction_info) ? "Messaging restricted" : "")).slice(0, 300),
        });
      } else {
        out.push({ kind: "other", wabaId, field: change.field });
      }
    }
  }
  return out;
}
