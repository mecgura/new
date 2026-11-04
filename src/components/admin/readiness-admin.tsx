"use client";

import * as React from "react";
import { CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, LoadingState, PageHeader, Select, type BadgeTone, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Status = "LIVE" | "CONFIGURATION_REQUIRED" | "APPROVAL_REQUIRED" | "PRACTICE_MODE" | "COMING_SOON" | "NOT_IMPLEMENTED";
type Item = { key: string; name: string; group: string; status: Status; detail: string; needs: string; verifiable: boolean; configured: boolean; lastVerification: { ok: boolean; at: string; detail: string } | null; powers: string };
type AiSettings = { provider: "auto" | "anthropic" | "openai"; fallback: boolean; models: { anthropic: string; openai: string } };
type Data = { items: Item[]; ai: { primary: string | null; fallback: string | null; settings: AiSettings } };

const BADGE: Record<Status, { label: string; tone: BadgeTone }> = {
  LIVE: { label: "LIVE", tone: "success" },
  CONFIGURATION_REQUIRED: { label: "CONFIGURATION REQUIRED", tone: "warning" },
  APPROVAL_REQUIRED: { label: "APPROVAL REQUIRED", tone: "info" },
  PRACTICE_MODE: { label: "PRACTICE MODE", tone: "neutral" },
  COMING_SOON: { label: "COMING SOON", tone: "neutral" },
  NOT_IMPLEMENTED: { label: "NOT IMPLEMENTED", tone: "danger" },
};
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Admin → Integrations readiness: every outside service with a status that is only LIVE after a real check. */
export function ReadinessAdmin() {
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [busy, setBusy] = React.useState("");
  const [ai, setAi] = React.useState<AiSettings | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>("/api/admin/readiness");
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    setAi(r.data.ai.settings);
  }, [toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function verify(key: string) {
    setBusy(key);
    const r = await apiFetch<{ result: { ok: boolean; detail: string } }>(`/api/admin/readiness/${key}/verify`, { method: "POST" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.result.ok ? `Verified: ${r.data.result.detail}` : `Check failed: ${r.data.result.detail}`, r.data.result.ok ? "success" : "error");
    void load();
  }
  async function verifyAll() {
    if (!data) return;
    setBusy("all");
    for (const i of data.items.filter((x) => x.verifiable && x.configured)) await apiFetch(`/api/admin/readiness/${i.key}/verify`, { method: "POST" });
    setBusy("");
    void load();
  }
  async function saveAi() {
    if (!ai) return;
    setBusy("ai");
    const r = await apiFetch<{ settings: AiSettings }>("/api/admin/ai/settings", { method: "PUT", body: ai });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("AI provider settings saved");
    void load();
  }

  if (!data || !ai) return <LoadingState />;
  const counts = data.items.reduce<Record<string, number>>((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {});
  return (
    <>
      <PageHeader
        title="Integrations readiness"
        description="Every outside service MECGURA depends on. LIVE only after a real check with the provider succeeded in the last 7 days."
        actions={<Button variant="secondary" onClick={() => void verifyAll()} loading={busy === "all"}><RefreshCw aria-hidden="true" /> Verify all configured</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(BADGE) as Status[]).filter((s) => counts[s]).map((s) => <Badge key={s} tone={BADGE[s].tone}>{counts[s]} {BADGE[s].label}</Badge>)}
      </div>

      <Card className="mb-4">
        <CardHeader title="AI provider" description={`Live AI now uses: ${data.ai.primary ?? "none (demo mode)"}${data.ai.fallback ? ` · falls back to ${data.ai.fallback}` : ""}. API keys are set in Vercel only — never here.`} />
        <CardBody className="grid gap-4 md:grid-cols-4">
          <Field id="ai-provider" label="Provider">
            <Select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as AiSettings["provider"] })}>
              <option value="auto">Auto (Anthropic if set, else OpenAI)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </Select>
          </Field>
          <Field id="ai-model-a" label="Anthropic model" hint="e.g. claude-haiku-5-5">
            <Input value={ai.models.anthropic} maxLength={80} onChange={(e) => setAi({ ...ai, models: { ...ai.models, anthropic: e.target.value } })} />
          </Field>
          <Field id="ai-model-o" label="OpenAI model" hint="e.g. gpt-5-mini">
            <Input value={ai.models.openai} maxLength={80} onChange={(e) => setAi({ ...ai, models: { ...ai.models, openai: e.target.value } })} />
          </Field>
          <div className="flex flex-col justify-end gap-3">
            <Checkbox id="ai-fallback" label="Use the other provider if this one is down" checked={ai.fallback} onChange={(e) => setAi({ ...ai, fallback: e.target.checked })} />
            <Button onClick={() => void saveAi()} loading={busy === "ai"}>Save</Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.items.map((i) => (
          <Card key={i.key}>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 text-body font-semibold text-app-text">{i.status === "LIVE" ? <CheckCircle2 className="size-4 text-emerald-400" aria-hidden="true" /> : <ShieldCheck className="size-4 text-app-subtle" aria-hidden="true" />}{i.name}</p>
                  <p className="text-caption text-app-subtle">{i.group} · {i.powers}</p>
                </div>
                <Badge tone={BADGE[i.status].tone}>{BADGE[i.status].label}</Badge>
              </div>
              <p className="text-small text-app-muted">{i.detail}</p>
              {i.status !== "LIVE" ? <Alert tone="info" className="text-small">{i.needs}</Alert> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption text-app-subtle">{i.lastVerification ? `Last check ${when(i.lastVerification.at)}: ${i.lastVerification.ok ? "OK" : "failed"}` : i.verifiable ? "Never checked" : "Can't be checked automatically"}</span>
                {i.verifiable ? <Button size="sm" variant="secondary" disabled={!i.configured} onClick={() => void verify(i.key)} loading={busy === i.key}>Verify</Button> : null}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
