"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, Copy, ExternalLink, FlaskConical, KeyRound, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Stepper, TabPanel, Tabs, buttonVariants, type Step } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { runEmbeddedSignup } from "@/components/whatsapp/meta-sdk";

type Account = { id: string; displayName: string; phoneNumber: string; status: string; isDemo: boolean; wabaId: string | null };
type Webhook = { callbackUrl: string; verifyToken: string | null; fields: string[]; mode: string; status: string };

export type WizardProps = {
  orgId: string;
  orgName: string;
  initialMethod: "meta" | "existing" | "developer";
  metaConfigured: boolean;
  missingMeta: string[];
  demoAvailable: boolean;
  encryptionReady: boolean;
  callbackUrl: string;
  slotsFull: boolean;
};

const META_STEPS: Step[] = [
  { id: "auth", label: "Meta authentication", description: "Sign in with Facebook / Meta" },
  { id: "portfolio", label: "Business Portfolio", description: "Choose or create your business portfolio" },
  { id: "waba", label: "WhatsApp Business Account", description: "Choose or create a WABA" },
  { id: "phone", label: "Phone Number", description: "Add and verify the number" },
  { id: "permissions", label: "Permissions", description: "Allow MECGURA to manage messaging" },
  { id: "result", label: "Connection result", description: "MECGURA verifies and saves the connection" },
  { id: "return", label: "Return to MECGURA" },
];

const DEMO_PERMISSIONS = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"];

function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Field id={id} label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-small" />
        <Button
          variant="secondary"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Field>
  );
}

function ConnectedResult({ account, demo }: { account: Account; demo?: boolean }) {
  return (
    <div className="space-y-4">
      <Alert tone={demo ? "info" : "success"} title={demo ? "Demo number added" : "WhatsApp number connected"}>
        {account.displayName} · {account.phoneNumber}
        {demo ? " — this is fictional demo data. It cannot send or receive real messages." : null}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Link href={`/whatsapp/accounts/${account.id}`} className={buttonVariants({ variant: "primary" })}>
          Return to MECGURA — view number
        </Link>
        <Link href="/whatsapp/accounts" className={buttonVariants({ variant: "secondary" })}>
          All numbers
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ConnectWizard(props: WizardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = React.useState(props.initialMethod);
  const tabs = [
    { id: "meta", label: "Connect with Meta" },
    { id: "existing", label: "Existing WhatsApp Business" },
    { id: "developer", label: "API / Developer setup" },
  ];
  return (
    <>
      {props.slotsFull ? (
        <Alert tone="warning" className="mb-4">
          Your plan&apos;s WhatsApp number limit is reached. Disconnect a number or ask MECGURA to upgrade before connecting another.
        </Alert>
      ) : null}
      <Tabs
        label="Connection method"
        items={tabs}
        value={tab}
        onValueChange={(t) => {
          setTab(t as WizardProps["initialMethod"]);
          router.replace(`${pathname}?method=${t}`, { scroll: false });
        }}
      />
      <TabPanel id="meta" active={tab === "meta"}>
        <MetaPanel {...props} method="embedded_signup" />
      </TabPanel>
      <TabPanel id="existing" active={tab === "existing"}>
        <ExistingPanel {...props} />
      </TabPanel>
      <TabPanel id="developer" active={tab === "developer"}>
        <DeveloperPanel {...props} />
      </TabPanel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meta Embedded Signup (real) + Demo
// ---------------------------------------------------------------------------

function MetaPanel(props: WizardProps & { method: "embedded_signup" | "coexistence" }) {
  const [mode, setMode] = React.useState<"idle" | "real" | "demo">("idle");
  // The flows render their own live stepper; the overview card only shows while idle.
  const showOverview = mode === "idle" && !props.metaConfigured;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className={showOverview ? "lg:col-span-3" : "lg:col-span-5"}>
        <CardHeader
          title={props.method === "coexistence" ? "Connect an existing WhatsApp Business number" : "Connect with Meta"}
          action={props.method === "embedded_signup" ? <Badge tone="primary">Recommended</Badge> : undefined}
        />
        <CardBody>
          {mode === "demo" ? (
            <DemoFlow {...props} onExit={() => setMode("idle")} />
          ) : props.metaConfigured ? (
            <RealFlow {...props} />
          ) : (
            <div className="space-y-4">
              <Alert tone="warning" title="Meta onboarding isn't configured yet">
                MECGURA&apos;s Meta app hasn&apos;t been set up on this installation, so Meta&apos;s onboarding window can&apos;t open. No connection will be faked.
                <details className="mt-2">
                  <summary className="cursor-pointer">For administrators</summary>
                  <p className="mt-1">Missing server settings: {props.missingMeta.join(", ")}.</p>
                </details>
              </Alert>
              {props.demoAvailable && props.method === "embedded_signup" ? (
                <div className="rounded-[var(--radius-control)] border border-app-border p-4">
                  <p className="flex items-center gap-2 text-body font-medium text-app-text">
                    <FlaskConical className="size-4 text-app-info" aria-hidden="true" /> Try the flow in demo mode
                  </p>
                  <p className="mt-1 text-small text-app-muted">
                    Walk through every step with fictional data. The result is a clearly labelled demo number that can&apos;t send messages.
                  </p>
                  <Button className="mt-3" variant="secondary" onClick={() => setMode("demo")} disabled={props.slotsFull}>
                    Start demo connection
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
      {showOverview ? (
        <Card className="lg:col-span-2">
          <CardHeader title="What happens" />
          <CardBody>
            <Stepper steps={META_STEPS} current={-1} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function RealFlow(props: WizardProps & { method: "embedded_signup" | "coexistence" }) {
  const [phase, setPhase] = React.useState<"ready" | "popup" | "saving" | "done" | "error" | "cancelled">("ready");
  const [error, setError] = React.useState("");
  const [account, setAccount] = React.useState<Account | null>(null);

  async function begin() {
    setError("");
    setPhase("popup");
    const start = await apiFetch<{ state: string; meta: { appId: string; configId: string; graphVersion: string }; featureType: string }>(
      `/api/organizations/${props.orgId}/whatsapp/connect/meta/start`,
      { method: "POST", body: { method: props.method } }
    );
    if (!start.ok) {
      setPhase("error");
      return setError(start.error);
    }
    const { state, meta, featureType } = start.data;
    let result;
    try {
      result = await runEmbeddedSignup({ ...meta, featureType });
    } catch (e) {
      result = { kind: "error" as const, message: e instanceof Error ? e.message : "Meta sign-in failed." };
    }
    if (result.kind !== "finish") {
      const reason = result.kind === "cancel" ? `Cancelled at ${result.step}` : result.message;
      await apiFetch(`/api/organizations/${props.orgId}/whatsapp/connect/meta/cancel`, { method: "POST", body: { state, reason } });
      setPhase(result.kind === "cancel" ? "cancelled" : "error");
      return setError(result.kind === "cancel" ? "You closed Meta's window before finishing. Nothing was connected." : result.message);
    }
    setPhase("saving");
    const done = await apiFetch<{ account: Account }>(`/api/organizations/${props.orgId}/whatsapp/connect/meta/complete`, {
      method: "POST",
      body: { state, code: result.code, wabaId: result.wabaId, phoneNumberId: result.phoneNumberId },
    });
    if (!done.ok) {
      setPhase("error");
      return setError(done.error);
    }
    setAccount(done.data.account);
    setPhase("done");
  }

  const current = phase === "ready" ? 0 : phase === "popup" ? 0 : phase === "saving" ? 5 : phase === "done" ? 6 : 0;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        {phase === "done" && account ? (
          <ConnectedResult account={account} />
        ) : (
          <>
            <p className="text-body text-app-muted">
              {props.method === "coexistence"
                ? "Meta's window will check whether your current WhatsApp Business app number can be connected. If it isn't eligible, Meta will tell you."
                : "A Meta window opens where you sign in, choose your business portfolio and WhatsApp Business Account, add a number and grant permissions."}
            </p>
            {error ? <Alert tone={phase === "cancelled" ? "warning" : "danger"}>{error}</Alert> : null}
            {phase === "popup" ? <Alert tone="info">Complete the steps in Meta&apos;s window. Keep this tab open.</Alert> : null}
            {phase === "saving" ? <Alert tone="info">Verifying with Meta and saving your connection…</Alert> : null}
            <Button size="lg" onClick={begin} loading={phase === "popup" || phase === "saving"} disabled={props.slotsFull}>
              <ShieldCheck aria-hidden="true" />
              {props.method === "coexistence" ? "Connect Existing Number" : phase === "error" || phase === "cancelled" ? "Try again" : "Continue with Meta"}
            </Button>
          </>
        )}
      </div>
      <Stepper steps={META_STEPS} current={current} failedAt={phase === "error" ? current : undefined} />
    </div>
  );
}

function DemoFlow(props: WizardProps & { onExit: () => void }) {
  const [step, setStep] = React.useState(0);
  const [portfolio, setPortfolio] = React.useState(`${props.orgName} (Demo)`);
  const [businessName, setBusinessName] = React.useState(props.orgName);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [account, setAccount] = React.useState<Account | null>(null);

  async function connect() {
    setSaving(true);
    setError("");
    const r = await apiFetch<{ account: Account }>(`/api/organizations/${props.orgId}/whatsapp/connect/demo`, { method: "POST", body: { businessName } });
    setSaving(false);
    if (!r.ok) return setError(r.details?.businessName?.[0] ?? r.error);
    setAccount(r.data.account);
    setStep(6);
  }

  const next = () => setStep((s) => s + 1);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <Badge tone="info">
          <FlaskConical className="size-3" aria-hidden="true" /> Demo mode — no Meta connection
        </Badge>
        {step === 0 ? (
          <>
            <p className="text-body text-app-muted">In the real flow you sign in with Facebook in a Meta window. Here, nothing is sent to Meta.</p>
            <Button onClick={next}>Sign in (demo)</Button>
          </>
        ) : step === 1 ? (
          <>
            <Field id="demo-portfolio" label="Business portfolio (demo)">
              <Input value={portfolio} onChange={(e) => setPortfolio(e.target.value)} />
            </Field>
            <Button onClick={next} disabled={portfolio.trim().length < 2}>
              Continue
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Field id="demo-business" label="WhatsApp Business Account name (demo)" error={error}>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} />
            </Field>
            <Button onClick={next} disabled={businessName.trim().length < 2}>
              Continue
            </Button>
          </>
        ) : step === 3 ? (
          <>
            <p className="text-body text-app-muted">A fictional number in the +1 202-555 range will be assigned. It can&apos;t receive calls or messages.</p>
            <Button onClick={next}>Use a demo number</Button>
          </>
        ) : step === 4 ? (
          <>
            <p className="text-body text-app-muted">The real flow asks you to allow these permissions:</p>
            <ul className="space-y-2">
              {DEMO_PERMISSIONS.map((p) => (
                <li key={p}>
                  <Checkbox label={<code className="text-small">{p}</code>} checked readOnly disabled />
                </li>
              ))}
            </ul>
            <Button onClick={next}>Allow (demo)</Button>
          </>
        ) : step === 5 ? (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <p className="text-body text-app-muted">Ready to create the demo connection for “{businessName}”.</p>
            <Button onClick={connect} loading={saving}>
              Create demo connection
            </Button>
          </>
        ) : account ? (
          <ConnectedResult account={account} demo />
        ) : null}
        {step < 6 ? (
          <Button variant="ghost" size="sm" onClick={props.onExit}>
            Exit demo
          </Button>
        ) : null}
      </div>
      <Stepper steps={META_STEPS} current={step} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing WhatsApp Business (coexistence)
// ---------------------------------------------------------------------------

function ExistingPanel(props: WizardProps) {
  const [ack, setAck] = React.useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="I already use WhatsApp Business" />
        <CardBody className="space-y-4">
          <p className="text-body text-app-muted">
            Connect an existing WhatsApp Business setup where Meta&apos;s supported coexistence/migration flow is available. This keeps using a number you already have instead of registering a new one.
          </p>
          <Alert tone="info" title="Eligibility depends on Meta">
            Availability is not universal. Meta decides during the flow based on its currently supported setup — for example the country, the WhatsApp Business app version, how the number is used today and the account&apos;s status. If your number isn&apos;t eligible, Meta will say so and you can connect a new number with &ldquo;Connect with Meta&rdquo; instead.
          </Alert>
          {!props.metaConfigured ? (
            <Alert tone="warning" title="Not available yet on MECGURA">
              This option uses Meta&apos;s onboarding window, which isn&apos;t configured on this installation yet. A demo of the standard flow is available under &ldquo;Connect with Meta&rdquo;.
            </Alert>
          ) : (
            <>
              <Checkbox label="I understand eligibility is decided by Meta and isn't guaranteed." checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {ack ? <RealFlow {...props} method="coexistence" /> : null}
            </>
          )}
          {!props.metaConfigured ? (
            <Button disabled>Connect Existing Number</Button>
          ) : null}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Before you start" />
        <CardBody>
          <ul className="space-y-2 text-small text-app-muted">
            <li>• Keep the WhatsApp Business app on your phone updated.</li>
            <li>• Have access to the Meta business portfolio that owns the number.</li>
            <li>• Check Meta&apos;s current coexistence documentation for supported regions and limits.</li>
          </ul>
          <a href="https://developers.facebook.com/docs/whatsapp/embedded-signup" target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex items-center gap-1 text-small text-app-primary hover:text-app-primary-hover">
            Meta Embedded Signup docs <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API / developer setup
// ---------------------------------------------------------------------------

function DeveloperPanel(props: WizardProps) {
  const [form, setForm] = React.useState({ wabaId: "", phoneNumberId: "", accessToken: "", appSecret: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState<{ account: Account; webhook: Webhook | null } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (!/^\d{5,25}$/.test(form.wabaId.trim())) e.wabaId = "WABA ID must be the numeric ID from Meta";
    if (!/^\d{5,25}$/.test(form.phoneNumberId.trim())) e.phoneNumberId = "Phone Number ID must be the numeric ID from Meta";
    if (form.accessToken.trim().length < 50) e.accessToken = "Paste the full permanent (system user) access token";
    if (form.appSecret && !/^[a-f0-9]{32}$/i.test(form.appSecret.trim())) e.appSecret = "App secret is a 32-character hex value";
    return e;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    const r = await apiFetch<{ account: Account }>(`/api/organizations/${props.orgId}/whatsapp/connect/manual`, { method: "POST", body: form });
    if (!r.ok) {
      setSaving(false);
      const d = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, val]) => [k, val?.[0] ?? ""]));
      return setErrors({ ...d, form: r.details ? "" : r.error });
    }
    // Secrets leave browser memory as soon as they're saved.
    setForm({ wabaId: "", phoneNumberId: "", accessToken: "", appSecret: "" });
    const wh = await apiFetch<{ webhook: Webhook }>(`/api/organizations/${props.orgId}/whatsapp/accounts/${r.data.account.id}/webhook`);
    setSaving(false);
    setResult({ account: r.data.account, webhook: wh.ok ? wh.data.webhook : null });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="API / Developer setup" description="For businesses with their own Meta app and a permanent system-user token." />
        <CardBody>
          {result ? (
            <div className="space-y-5">
              <ConnectedResult account={result.account} />
              <Alert tone="info" title="Access token stored securely">
                Your token is encrypted and will not be shown again. To change it, disconnect and connect again.
              </Alert>
              {result.webhook ? (
                <div className="space-y-3">
                  <p className="text-body font-medium text-app-text">Configure your Meta app webhook</p>
                  <CopyField id="cb-url" label="Callback URL" value={result.webhook.callbackUrl} />
                  {result.webhook.verifyToken ? <CopyField id="verify-token" label="Verify token" value={result.webhook.verifyToken} /> : null}
                  <p className="text-small text-app-muted">Subscribe to: {result.webhook.fields.join(", ")}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4" autoComplete="off">
              {!props.encryptionReady ? <Alert tone="warning">Secure credential storage isn&apos;t configured on this server yet, so tokens can&apos;t be saved.</Alert> : null}
              {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="wabaId" label="WABA ID" hint="WhatsApp Business Account ID" error={errors.wabaId}>
                  <Input inputMode="numeric" value={form.wabaId} onChange={set("wabaId")} placeholder="e.g. 102290129340398" />
                </Field>
                <Field id="phoneNumberId" label="Phone Number ID" hint="Not the phone number itself" error={errors.phoneNumberId}>
                  <Input inputMode="numeric" value={form.phoneNumberId} onChange={set("phoneNumberId")} placeholder="e.g. 106540352242922" />
                </Field>
              </div>
              <Field id="accessToken" label="Access token" hint="Permanent system-user token with whatsapp_business_management and whatsapp_business_messaging." error={errors.accessToken}>
                <Input type="password" value={form.accessToken} onChange={set("accessToken")} autoComplete="new-password" spellCheck={false} />
              </Field>
              <Field id="appSecret" label="App secret (optional)" hint="Needed so MECGURA can verify webhook signatures from your Meta app." error={errors.appSecret}>
                <Input type="password" value={form.appSecret} onChange={set("appSecret")} autoComplete="new-password" spellCheck={false} />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-caption text-app-subtle">
                  <KeyRound className="size-3.5" aria-hidden="true" /> Verified with Meta, then encrypted. Never displayed after saving.
                </p>
                <Button type="submit" loading={saving} disabled={!props.encryptionReady || props.slotsFull}>
                  Verify &amp; connect
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Webhook information" />
        <CardBody className="space-y-4">
          <CopyField id="cb-url-info" label="Callback URL" value={props.callbackUrl} />
          <p className="text-small text-app-muted">A unique verify token is generated for your connection after you save, and shown here once connected.</p>
          <div>
            <p className="text-small font-medium text-app-text">Webhook fields</p>
            <p className="text-small text-app-muted">messages, message_template_status_update, phone_number_quality_update, account_update</p>
          </div>
          <p className="flex items-start gap-2 text-caption text-app-subtle">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Events are accepted only with a valid Meta signature.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
