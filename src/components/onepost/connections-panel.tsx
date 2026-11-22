"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Link2, Plug, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmationDialog, ErrorState, Field, Input, LoadingState, Modal, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { PROVIDER_LABELS, type ConnectionProvider } from "@/lib/onepost-publish";
import type { ConnectionDto } from "@/services/onepost/connections";

type Data = {
  connections: ConnectionDto[];
  channels: { facebook: { name: string } | null; instagram: { name: string } | null };
  configured: Record<OAuthP, boolean>;
  missingEnv: Record<OAuthP, string>;
  storage: boolean;
};
type Target = { id: string; name: string };
type OAuthP = "linkedin" | "gbp" | "youtube" | "gsc";

const STATUS = { active: ["success", "Connected"], needs_target: ["warning", "Choose where to post"], expired: ["danger", "Expired. Reconnect"] } as const;

/** The accounts a workspace posts to. Facebook and Instagram come from Channels; the rest are connected here (owners only). */
export function ConnectionsPanel({ orgId, canConnect, flash }: { orgId: string; canConnect: boolean; flash?: { connected?: string; message?: string; error?: string } }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [picking, setPicking] = React.useState<{ conn: ConnectionDto; targets: Target[]; choice: string } | null>(null);
  const [removing, setRemoving] = React.useState<ConnectionDto | null>(null);
  const [wp, setWp] = React.useState<{ site: string; username: string; appPassword: string; status: "publish" | "draft" } | null>(null);
  const [wpErrors, setWpErrors] = React.useState<Record<string, string>>({});
  const [wpError, setWpError] = React.useState("");

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`${base}/connections`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function connect(provider: OAuthP) {
    setBusy(provider);
    const r = await apiFetch<{ url: string }>(`${base}/connections/oauth/${provider}`, { method: "POST", body: {} });
    if (!r.ok) {
      setBusy("");
      return toast(r.error, "error");
    }
    window.location.assign(r.data.url);
  }

  async function choose(conn: ConnectionDto) {
    setBusy(conn.id);
    const r = await apiFetch<{ targets: Target[] }>(`${base}/connections/${conn.id}/targets`);
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    if (!r.data.targets.length) return toast(conn.provider === "gbp" ? "No business locations were found on this Google account. Google must approve Business Profile API access for MECGURA first." : "No accounts were found.", "error");
    setPicking({ conn, targets: r.data.targets, choice: r.data.targets[0].id });
  }

  async function saveChoice() {
    if (!picking) return;
    setBusy("pick");
    const r = await apiFetch(`${base}/connections/${picking.conn.id}/targets`, { method: "PUT", body: { targetId: picking.choice } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setPicking(null);
    toast("Saved", "success");
    void load();
  }

  async function saveWp() {
    if (!wp) return;
    setBusy("wp");
    setWpErrors({});
    setWpError("");
    const r = await apiFetch(`${base}/connections/wordpress`, { method: "POST", body: wp });
    setBusy("");
    if (!r.ok) {
      setWpError(r.error);
      return setWpErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
    }
    setWp(null);
    toast("WordPress connected", "success");
    void load();
  }

  async function setWpMode(conn: ConnectionDto, wpStatus: "publish" | "draft") {
    const r = await apiFetch(`${base}/connections/${conn.id}`, { method: "PATCH", body: { wpStatus } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  async function setPrivacy(conn: ConnectionDto, ytPrivacy: "public" | "unlisted" | "private") {
    const r = await apiFetch(`${base}/connections/${conn.id}`, { method: "PATCH", body: { ytPrivacy } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  async function remove() {
    if (!removing) return;
    setBusy("remove");
    const r = await apiFetch(`${base}/connections/${removing.id}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setRemoving(null);
    toast("Disconnected. Anything still waiting for it was cancelled.", "success");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading connections…" />;
  const by = (p: ConnectionProvider) => data.connections.filter((c) => c.provider === p);

  const Row = ({ conn }: { conn: ConnectionDto }) => {
    const [tone, label] = STATUS[conn.status];
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-app-border p-3">
        <div className="min-w-0">
          <p className="break-words text-body font-medium text-app-text">{conn.name || PROVIDER_LABELS[conn.provider]}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot>
              {label}
            </Badge>
            {conn.expiresAt && conn.provider === "linkedin" ? <span className="text-caption text-app-subtle">Sign-in valid until {new Date(conn.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span> : null}
          </div>
        </div>
        {canConnect ? (
          <div className="flex flex-wrap items-center gap-2">
            {conn.provider === "wordpress" ? (
              <Select aria-label="When posting" value={conn.wpStatus} onChange={(e) => void setWpMode(conn, e.target.value as "publish" | "draft")} className="w-44">
                <option value="publish">Publish live</option>
                <option value="draft">Save as draft</option>
              </Select>
            ) : conn.provider === "youtube" ? (
              <Select aria-label="Who can see new videos" value={conn.ytPrivacy} onChange={(e) => void setPrivacy(conn, e.target.value as "public" | "unlisted" | "private")} className="w-44">
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private (only me)</option>
              </Select>
            ) : (
              <Button size="sm" variant="secondary" loading={busy === conn.id} onClick={() => void choose(conn)}>
                {conn.provider === "gbp" ? "Choose location" : conn.provider === "gsc" ? "Choose website" : conn.pages ? "Choose account" : "Account"}
              </Button>
            )}
            {conn.provider !== "wordpress" ? (
              <Button size="sm" variant="secondary" onClick={() => void connect(conn.provider as OAuthP)}>
                Reconnect
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" aria-label={`Disconnect ${conn.name}`} onClick={() => setRemoving(conn)}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const section = (provider: OAuthP, blurb: string) => (
    <Card>
      <CardHeader
        title={PROVIDER_LABELS[provider]}
        description={blurb}
        action={
          canConnect && data.configured[provider] && !by(provider).length ? (
            <Button loading={busy === provider} onClick={() => void connect(provider)}>
              <Plug aria-hidden="true" /> Connect
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {!data.configured[provider] ? <Alert tone="warning">Sign-in with {PROVIDER_LABELS[provider]} isn&apos;t set up on this server yet. MECGURA needs to add {data.missingEnv[provider]}.</Alert> : null}
        {by(provider).map((c) => (
          <Row key={c.id} conn={c} />
        ))}
        {provider === "linkedin" && by("linkedin").some((c) => !c.pages) ? <p className="text-caption text-app-subtle">Posts go to your personal profile. Posting to a Company Page needs LinkedIn&apos;s approval of MECGURA&apos;s app for page access.</p> : null}
        {provider === "gbp" ? <p className="text-caption text-app-subtle">Google must approve Business Profile API access for MECGURA before posts can be published. Until then, connecting works but posting is refused by Google.</p> : null}
        {provider === "youtube" ? <p className="text-caption text-app-subtle">Videos are uploaded to your channel. Until Google approves MECGURA&apos;s YouTube app, uploads from a new app can be forced to Private. Long videos can take more than the server&apos;s time limit; use a short video or upload very large ones in YouTube Studio.</p> : null}
        {provider === "gsc" ? <p className="text-caption text-app-subtle">Read-only. Used for search clicks and keywords in Reports. Nothing is changed on your site.</p> : null}
      </CardBody>
    </Card>
  );

  return (
    <div className="mt-5 space-y-4">
      {flash?.connected ? <Alert tone="success" title={`${PROVIDER_LABELS[flash.connected as ConnectionDto["provider"]] ?? "Account"} connected`}>{flash.message}</Alert> : null}
      {flash?.error ? <Alert tone="danger" title="Could not connect">{flash.error}</Alert> : null}
      {!canConnect ? <Alert tone="info">Only the workspace owner can connect or disconnect accounts.</Alert> : null}
      {!data.storage ? (
        <Alert tone="warning" title="File storage isn't connected">
          Instagram, Facebook and Google need a public link to each photo, and videos can only be uploaded when Vercel Blob is connected. Ask MECGURA to connect file storage.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Facebook and Instagram" description="These use the accounts connected in Channels, the same ones Social Media uses." />
        <CardBody className="space-y-2">
          {(["facebook", "instagram"] as const).map((k) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-app-border p-3">
              <div>
                <p className="text-body font-medium text-app-text">{k === "facebook" ? "Facebook Page" : "Instagram"}</p>
                <p className="text-small text-app-muted">{data.channels[k] ? data.channels[k]!.name : "Not connected"}</p>
              </div>
              {data.channels[k] ? (
                <Badge tone="success" dot>
                  <CheckCircle2 className="size-3" aria-hidden="true" /> Connected
                </Badge>
              ) : (
                <Link href="/channels" className="inline-flex items-center gap-1 text-small text-app-primary hover:underline">
                  Connect in Channels <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      {section("linkedin", "Posts to your LinkedIn profile (or a Company Page once LinkedIn approves it).")}
      {section("gbp", "“What's new” posts on your Google Business Profile location.")}
      {section("youtube", "Uploads approved videos to your YouTube channel.")}
      {section("gsc", "Shows how your website performs in Google Search (clicks and keywords).")}

      <Card>
        <CardHeader
          title="WordPress"
          description="Publishes the website blog to your self-hosted WordPress site."
          action={
            canConnect ? (
              <Button onClick={() => { setWp({ site: "", username: "", appPassword: "", status: "publish" }); setWpErrors({}); setWpError(""); }}>
                <Link2 aria-hidden="true" /> Connect a site
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-3">
          {by("wordpress").map((c) => (
            <Row key={c.id} conn={c} />
          ))}
          {!by("wordpress").length ? <p className="text-small text-app-muted">No site connected yet.</p> : null}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(picking)}
        onClose={() => setPicking(null)}
        title={picking?.conn.provider === "gbp" ? "Choose the business location" : picking?.conn.provider === "gsc" ? "Choose the website" : "Choose where to post"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicking(null)}>
              Cancel
            </Button>
            <Button onClick={saveChoice} loading={busy === "pick"}>
              Use this
            </Button>
          </>
        }
      >
        {picking ? (
          <Field id="pick-target" label="Account">
            <Select value={picking.choice} onChange={(e) => setPicking({ ...picking, choice: e.target.value })}>
              {picking.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(wp)}
        onClose={() => setWp(null)}
        title="Connect a WordPress site"
        description="Uses a WordPress Application Password: a separate password you can revoke any time. Your normal login is never needed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWp(null)}>
              Cancel
            </Button>
            <Button onClick={saveWp} loading={busy === "wp"}>
              Connect
            </Button>
          </>
        }
      >
        {wp ? (
          <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void saveWp(); }} className="space-y-4">
            {wpError ? <Alert tone="danger">{wpError}</Alert> : null}
            <Field id="wp-site" label="Website address" hint="For example myblog.com. It must use https." error={wpErrors.site}>
              <Input value={wp.site} onChange={(e) => setWp({ ...wp, site: e.target.value })} inputMode="url" placeholder="myblog.com" />
            </Field>
            <Field id="wp-user" label="WordPress username" error={wpErrors.username}>
              <Input value={wp.username} onChange={(e) => setWp({ ...wp, username: e.target.value })} autoComplete="off" />
            </Field>
            <Field id="wp-pass" label="Application Password" hint="In WordPress: Users → Profile → Application Passwords → add one named MECGURA. It is stored encrypted and never shown again." error={wpErrors.appPassword}>
              <Input type="password" value={wp.appPassword} onChange={(e) => setWp({ ...wp, appPassword: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field id="wp-mode" label="When posting">
              <Select value={wp.status} onChange={(e) => setWp({ ...wp, status: e.target.value as "publish" | "draft" })}>
                <option value="publish">Publish live</option>
                <option value="draft">Save as a draft for me to review in WordPress</option>
              </Select>
            </Field>
          </form>
        ) : null}
      </Modal>

      <ConfirmationDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void remove()} loading={busy === "remove"} title={`Disconnect ${removing?.name || ""}?`} description="Posts still waiting to go to this account are cancelled. Posts already published stay where they are." confirmLabel="Disconnect" />
    </div>
  );
}
