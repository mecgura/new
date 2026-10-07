"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bold, Braces, CheckCircle2, Copy, ExternalLink, Italic, Megaphone, Phone, Plus, Reply, Send, ShieldCheck, Trash2, X, XCircle } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  buttonVariants,
  useToast,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DEFAULT_AUTH_OPTIONS,
  LIMITS,
  STATUS_LABELS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  validateTemplate,
  variableCount,
  type HeaderType,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDef,
} from "@/lib/templates";
import { dayFmt } from "@/components/inbox/types";
import { WaPreview } from "@/components/templates/wa-preview";
import { QUALITY, STATUS_TONE, wabaLabel, type TemplateAccount, type TemplateView } from "@/components/templates/types";

const EMPTY: TemplateDef = {
  name: "",
  language: "en",
  category: "MARKETING",
  headerType: "none",
  headerText: "",
  body: "",
  footer: "",
  buttons: [],
  examples: {},
  authOptions: DEFAULT_AUTH_OPTIONS,
};

function pick(t: TemplateView): TemplateDef {
  return { name: t.name, language: t.language, category: t.category, headerType: t.headerType, headerText: t.headerText, body: t.body, footer: t.footer, buttons: t.buttons, examples: t.examples, authOptions: t.authOptions };
}

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span className={cn("text-caption", value.length > max ? "text-red-300" : "text-app-subtle")}>
    {value.length}/{max}
  </span>
);

export function TemplateEditor({ orgId, accounts, template, canManage }: { orgId: string; accounts: TemplateAccount[]; template?: TemplateView; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [t, setT] = React.useState<TemplateView | undefined>(template);
  const [def, setDef] = React.useState<TemplateDef>(template ? pick(template) : EMPTY);
  const [wabaId, setWabaId] = React.useState(template?.waba.id ?? accounts[0]?.id ?? "");
  const [attempted, setAttempted] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "save" | "submit" | "review" | "delete">("");
  const [sample, setSample] = React.useState<File | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [dupOpen, setDupOpen] = React.useState(false);
  const [delOpen, setDelOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const editable = canManage && (!t || t.status === "draft" || t.status === "rejected");
  const account = accounts.find((a) => a.id === wabaId) ?? (t ? { ...t.waba, accounts: t.waba.numbers } : undefined);
  const isDemo = account?.isDemo ?? false;
  const auth = def.category === "AUTHENTICATION";
  const media = !auth && def.headerType !== "none" && def.headerType !== "text";
  const nameLocked = Boolean(t?.metaTemplateId && !t.isDemo);

  const v = React.useMemo(() => validateTemplate(def, { forSubmit: true }), [def]);
  const draftErrors = React.useMemo(() => validateTemplate(def).errors, [def]);
  const errs = { ...(attempted ? v.errors : {}), ...serverErrors };
  const err = (k: string) => errs[k]?.[0];

  const set = <K extends keyof TemplateDef>(k: K, value: TemplateDef[K]) => {
    setDef((d) => ({ ...d, [k]: value }));
    setServerErrors((e) => ({ ...e, [k]: [] }));
  };
  const setBodyExample = (i: number, value: string) => setDef((d) => {
    const body = [...(d.examples.body ?? [])];
    body[i] = value;
    return { ...d, examples: { ...d.examples, body } };
  });
  const setButton = (i: number, patch: Partial<TemplateButton>) => setDef((d) => ({ ...d, buttons: d.buttons.map((b, j) => (j === i ? ({ ...b, ...patch } as TemplateButton) : b)) }));

  function insertAtCursor(before: string, after = "") {
    const el = bodyRef.current;
    const s = el?.selectionStart ?? def.body.length;
    const e = el?.selectionEnd ?? def.body.length;
    const next = def.body.slice(0, s) + before + def.body.slice(s, e) + after + def.body.slice(e);
    set("body", next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + before.length, e + before.length);
    });
  }
  const addVariable = () => insertAtCursor(`{{${variableCount(def.body) + 1}}}`);

  async function save(): Promise<TemplateView | null> {
    setFormError("");
    const payload = { ...def, name: def.name.trim() };
    const r = t
      ? await apiFetch<{ template: TemplateView }>(`/api/organizations/${orgId}/templates/${t.id}`, { method: "PATCH", body: payload })
      : await apiFetch<{ template: TemplateView }>(`/api/organizations/${orgId}/templates`, { method: "POST", body: { ...payload, wabaId } });
    if (!r.ok) {
      setServerErrors(r.details ?? {});
      setFormError(r.error);
      return null;
    }
    setServerErrors({});
    setT(r.data.template);
    if (!t) router.replace(`/templates/${r.data.template.id}`);
    return r.data.template;
  }

  async function onSave() {
    if (Object.keys(draftErrors).length) {
      setAttempted(true);
      return setFormError("Please fix the highlighted fields.");
    }
    setBusy("save");
    const saved = await save();
    setBusy("");
    if (saved) toast("Draft saved");
  }

  async function onSubmit() {
    setAttempted(true);
    if (Object.keys(v.errors).length) return setFormError("Complete the highlighted fields — Meta needs them to review the template.");
    if (media && !isDemo && !sample) return setServerErrors({ headerSample: [`Attach a sample ${def.headerType} for Meta's review.`] });
    setBusy("submit");
    const saved = editable ? await save() : t;
    if (!saved) return setBusy("");
    let res: Response | null = null;
    let body: { template?: TemplateView; error?: string; details?: Record<string, string[]> } = {};
    try {
      if (sample) {
        const fd = new FormData();
        fd.set("sample", sample);
        res = await fetch(`/api/organizations/${orgId}/templates/${saved.id}/submit`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/organizations/${orgId}/templates/${saved.id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      }
      body = await res.json().catch(() => ({}));
    } catch {
      body = { error: "Network error — try again." };
    }
    setBusy("");
    if (!res?.ok || !body.template) {
      setServerErrors(body.details ?? {});
      return setFormError(body.error ?? "Submission failed.");
    }
    setT(body.template);
    setDef(pick(body.template));
    toast(body.template.isDemo ? "Submitted (demo) — use the demo review buttons to approve or reject" : "Submitted to Meta for review");
    router.refresh();
  }

  async function review(decision: "approved" | "rejected", reason = "") {
    if (!t) return;
    setBusy("review");
    const r = await apiFetch<{ template: TemplateView }>(`/api/organizations/${orgId}/templates/${t.id}/review`, { method: "POST", body: { decision, reason } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setT(r.data.template);
    setRejectOpen(false);
    toast(decision === "approved" ? "Template approved (demo)" : "Template rejected (demo)");
  }

  async function remove() {
    if (!t) return;
    setBusy("delete");
    const r = await apiFetch(`/api/organizations/${orgId}/templates/${t.id}`, { method: "DELETE" });
    setBusy("");
    if (!r.ok) {
      setDelOpen(false);
      return toast(r.error, "error");
    }
    toast("Template deleted");
    router.push("/templates");
  }

  const bodyVars = variableCount(def.body);
  const headerVar = def.headerType === "text" && variableCount(def.headerText) > 0;
  const counts = { qr: def.buttons.filter((b) => b.type === "QUICK_REPLY").length, url: def.buttons.filter((b) => b.type === "URL").length, phone: def.buttons.filter((b) => b.type === "PHONE_NUMBER").length };

  return (
    <>
      <PageHeader
        title={t ? <span className="font-mono">{t.name}</span> : "New template"}
        breadcrumb={[{ label: "Templates", href: "/templates" }, { label: t ? t.name : "New" }]}
        description={t ? `${CATEGORY_LABELS[t.category]} · ${TEMPLATE_LANGUAGES.find((l) => l.code === t.language)?.label ?? t.language} · ${wabaLabel(t.waba)}` : "Write the message, add variables and buttons, then submit it to Meta for approval."}
        actions={
          t && canManage ? (
            <>
              <Button variant="secondary" onClick={() => setDupOpen(true)}>
                <Copy aria-hidden="true" /> Duplicate
              </Button>
              <Button variant="ghost" onClick={() => setDelOpen(true)} aria-label="Delete template">
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {t ? <StatusPanel t={t} onApprove={() => review("approved")} onReject={() => setRejectOpen(true)} busy={busy === "review"} canManage={canManage} /> : null}
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <fieldset disabled={!editable} className="min-w-0 space-y-4 disabled:opacity-90">
            <Card>
              <CardHeader title="Basics" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                {!t ? (
                  <Field id="tpl-account" label="WhatsApp account" className="sm:col-span-2" hint="Meta reviews templates per WhatsApp Business Account." error={err("wabaId")}>
                    <Select value={wabaId} onChange={(e) => setWabaId(e.target.value)}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{wabaLabel(a)}</option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field id="tpl-name" label="Template name" hint={nameLocked ? "Locked after submission to Meta" : "Lowercase, numbers and underscores — e.g. diwali_offer_2026"} error={err("name")}>
                  <Input
                    value={def.name}
                    disabled={nameLocked}
                    maxLength={LIMITS.name}
                    onChange={(e) => set("name", e.target.value.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                    placeholder="order_confirmation"
                    className="font-mono"
                  />
                </Field>
                <Field id="tpl-lang" label="Language" error={err("language")}>
                  <Select value={def.language} disabled={nameLocked} onChange={(e) => set("language", e.target.value)}>
                    {TEMPLATE_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
                    ))}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <p className="mb-1.5 text-small font-medium text-app-text" id="tpl-cat-label">Category</p>
                  <div role="radiogroup" aria-labelledby="tpl-cat-label" className="grid gap-2 sm:grid-cols-3">
                    {TEMPLATE_CATEGORIES.map((c) => (
                      <label key={c} className={cn("cursor-pointer rounded-xl border p-3 transition-colors", def.category === c ? "border-app-primary bg-app-primary-soft" : "border-app-border hover:bg-app-hover")}>
                        <input type="radio" name="tpl-category" value={c} checked={def.category === c} onChange={() => set("category", c as TemplateCategory)} className="sr-only" />
                        <span className="block text-small font-semibold text-app-text">{CATEGORY_LABELS[c]}</span>
                        <span className="mt-1 block text-caption text-app-muted">{CATEGORY_HINTS[c]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>

            {auth ? (
              <Card>
                <CardHeader title="Passcode message" description="Meta writes the text: “{{1}} is your verification code.” You choose the extras." />
                <CardBody className="space-y-4">
                  <Checkbox
                    label="Add security recommendation"
                    description="Appends “For your security, do not share this code.”"
                    checked={def.authOptions.addSecurityRecommendation}
                    onChange={(e) => set("authOptions", { ...def.authOptions, addSecurityRecommendation: e.target.checked })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="tpl-exp" label="Code expires after (minutes)" hint="1–90. Leave empty for no expiry footer." error={err("authOptions.codeExpirationMinutes")}>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={def.authOptions.codeExpirationMinutes ?? ""}
                        onChange={(e) => set("authOptions", { ...def.authOptions, codeExpirationMinutes: e.target.value ? Number(e.target.value) : null })}
                      />
                    </Field>
                    <Field id="tpl-otp-btn" label="Copy-code button text" error={err("authOptions.buttonText")}>
                      <Input value={def.authOptions.buttonText} maxLength={LIMITS.buttonText} onChange={(e) => set("authOptions", { ...def.authOptions, buttonText: e.target.value })} />
                    </Field>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader title="Header" description="Optional title or media shown above the message." />
                  <CardBody className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                      <Field id="tpl-htype" label="Header type">
                        <Select value={def.headerType} onChange={(e) => set("headerType", e.target.value as HeaderType)}>
                          <option value="none">No header</option>
                          <option value="text">Text</option>
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                          <option value="document">Document</option>
                        </Select>
                      </Field>
                      {def.headerType === "text" ? (
                        <Field id="tpl-htext" label={<span className="flex justify-between">Header text <Counter value={def.headerText} max={LIMITS.headerText} /></span>} hint="One variable allowed: {{1}}" error={err("headerText")}>
                          <Input value={def.headerText} onChange={(e) => set("headerText", e.target.value)} placeholder="Your order is on its way" />
                        </Field>
                      ) : null}
                    </div>
                    {headerVar ? (
                      <Field id="tpl-hex" label="Sample for header {{1}}" error={err("examples.header")}>
                        <Input value={def.examples.header?.[0] ?? ""} onChange={(e) => setDef((d) => ({ ...d, examples: { ...d.examples, header: [e.target.value] } }))} placeholder="Rahul" />
                      </Field>
                    ) : null}
                    {media ? (
                      isDemo ? (
                        <p className="text-caption text-app-muted">The {def.headerType} is chosen per send (campaign or inbox). Demo accounts don&apos;t need a review sample.</p>
                      ) : (
                        <Field id="tpl-sample" label={`Sample ${def.headerType} for Meta review`} hint={`Sent to Meta with the submission only — MECGURA doesn't store it. ${def.headerType === "image" ? "JPG/PNG ≤ 5 MB" : def.headerType === "video" ? "MP4 ≤ 16 MB" : "PDF"}`} error={err("headerSample")}>
                          <Input type="file" accept={def.headerType === "image" ? "image/jpeg,image/png" : def.headerType === "video" ? "video/mp4" : "application/pdf"} onChange={(e) => setSample(e.target.files?.[0] ?? null)} />
                        </Field>
                      )
                    ) : null}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Body" description="The main message. Use variables for details that change per customer." />
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button type="button" size="sm" variant="secondary" onClick={addVariable}>
                        <Braces aria-hidden="true" /> Add variable
                      </Button>
                      <IconButton type="button" label="Bold" onClick={() => insertAtCursor("*", "*")}>
                        <Bold aria-hidden="true" />
                      </IconButton>
                      <IconButton type="button" label="Italic" onClick={() => insertAtCursor("_", "_")}>
                        <Italic aria-hidden="true" />
                      </IconButton>
                      <span className="ml-auto"><Counter value={def.body} max={LIMITS.body} /></span>
                    </div>
                    <Field id="tpl-body" label="Message body" error={err("body")}>
                      <Textarea ref={bodyRef} value={def.body} onChange={(e) => set("body", e.target.value)} rows={7} placeholder={"Hi {{1}}, your order {{2}} has been shipped and will reach you by {{3}}. Track it anytime from the link below."} />
                    </Field>
                    {bodyVars ? (
                      <div className="rounded-xl border border-app-border p-3">
                        <p className="mb-2 text-small font-medium text-app-text">Sample values</p>
                        <p className="mb-3 text-caption text-app-muted">Meta reviews the template with these examples. Use realistic values, never real customer data.</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {Array.from({ length: bodyVars }, (_, i) => (
                            <Field key={i} id={`tpl-ex-${i + 1}`} label={`{{${i + 1}}}`} error={err(`examples.body.${i + 1}`)}>
                              <Input value={def.examples.body?.[i] ?? ""} onChange={(e) => setBodyExample(i, e.target.value)} />
                            </Field>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Footer & buttons" description="Optional. Up to 10 buttons: quick replies, 2 website links and 1 call button." />
                  <CardBody className="space-y-4">
                    <Field id="tpl-footer" label={<span className="flex justify-between">Footer <Counter value={def.footer} max={LIMITS.footer} /></span>} error={err("footer")}>
                      <Input value={def.footer} onChange={(e) => set("footer", e.target.value)} placeholder={def.category === "MARKETING" ? "Reply STOP to unsubscribe" : "MECGURA Store"} />
                    </Field>
                    {err("buttons") ? <Alert tone="danger">{err("buttons")}</Alert> : null}
                    <ul className="space-y-3">
                      {def.buttons.map((b, i) => (
                        <li key={i} className="rounded-xl border border-app-border p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <Badge tone="primary">{b.type === "QUICK_REPLY" ? "Quick reply" : b.type === "URL" ? "Website" : "Call"}</Badge>
                            <IconButton type="button" label={`Remove button ${i + 1}`} onClick={() => set("buttons", def.buttons.filter((_, j) => j !== i))}>
                              <X aria-hidden="true" />
                            </IconButton>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field id={`tpl-b${i}-text`} label="Button text" error={err(`buttons.${i}`)}>
                              <Input value={b.text} maxLength={LIMITS.buttonText} onChange={(e) => setButton(i, { text: e.target.value })} />
                            </Field>
                            {b.type === "URL" ? (
                              <Field id={`tpl-b${i}-url`} label="Website link" hint="Add {{1}} at the end for a per-customer link">
                                <Input value={b.url} onChange={(e) => setButton(i, { url: e.target.value.trim() })} placeholder="https://shop.example.com/orders/{{1}}" />
                              </Field>
                            ) : null}
                            {b.type === "PHONE_NUMBER" ? (
                              <Field id={`tpl-b${i}-phone`} label="Phone number">
                                <Input value={b.phone} onChange={(e) => setButton(i, { phone: e.target.value.trim() })} placeholder="+919876543210" />
                              </Field>
                            ) : null}
                            {b.type === "URL" && variableCount(b.url) ? (
                              <Field id={`tpl-b${i}-ex`} label="Sample full link" className="sm:col-span-2">
                                <Input value={b.example ?? ""} onChange={(e) => setButton(i, { example: e.target.value.trim() })} placeholder="https://shop.example.com/orders/12345" />
                              </Field>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" disabled={def.buttons.length >= LIMITS.buttons || counts.qr >= LIMITS.quickReplies} onClick={() => set("buttons", [...def.buttons, { type: "QUICK_REPLY", text: "" }])}>
                        <Reply aria-hidden="true" /> Quick reply
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={def.buttons.length >= LIMITS.buttons || counts.url >= LIMITS.urlButtons} onClick={() => set("buttons", [...def.buttons, { type: "URL", text: "", url: "" }])}>
                        <ExternalLink aria-hidden="true" /> Website
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={def.buttons.length >= LIMITS.buttons || counts.phone >= LIMITS.phoneButtons} onClick={() => set("buttons", [...def.buttons, { type: "PHONE_NUMBER", text: "", phone: "" }])}>
                        <Phone aria-hidden="true" /> Call
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </>
            )}
          </fieldset>

          {editable ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onSave} loading={busy === "save"} disabled={Boolean(busy)}>
                Save draft
              </Button>
              <Button onClick={onSubmit} loading={busy === "submit"} disabled={Boolean(busy)}>
                <Send aria-hidden="true" /> {isDemo ? "Submit for review (demo)" : "Submit to Meta for review"}
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <WaPreview t={def} values={Object.fromEntries((def.examples.body ?? []).map((x, i) => [`body.${i + 1}`, x]).concat(def.examples.header?.[0] ? [["header", def.examples.header[0]]] : []))} />
          {editable ? (
            <Card>
              <CardBody className="space-y-2">
                <p className="flex items-center gap-2 text-small font-medium text-app-text">
                  <ShieldCheck className="size-4 text-app-primary" aria-hidden="true" /> Review readiness
                </p>
                {Object.keys(v.errors).length ? (
                  <p className="text-caption text-app-muted">{Object.keys(v.errors).length} item(s) to complete before submitting.</p>
                ) : (
                  <p className="text-caption text-emerald-300">Ready to submit.</p>
                )}
                {v.warnings.map((w) => (
                  <p key={w} className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-caption text-amber-200">{w}</p>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>

      <RejectModal open={rejectOpen} onClose={() => setRejectOpen(false)} onReject={(reason) => review("rejected", reason)} busy={busy === "review"} />
      {t ? <DuplicateModal open={dupOpen} onClose={() => setDupOpen(false)} orgId={orgId} t={t} /> : null}
      <ConfirmationDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={remove}
        loading={busy === "delete"}
        title="Delete template?"
        description={t?.metaTemplateId && !t.isDemo ? "It will also be deleted from your WhatsApp Business Account on Meta. Meta doesn't let you reuse the name for 30 days." : "This removes the template from MECGURA."}
        confirmLabel="Delete template"
      />
    </>
  );
}

function StatusPanel({ t, onApprove, onReject, busy, canManage }: { t: TemplateView; onApprove: () => void; onReject: () => void; busy: boolean; canManage: boolean }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[t.status]} dot>{STATUS_LABELS[t.status]}</Badge>
          {t.status === "approved" ? <Badge tone={QUALITY[t.qualityScore]?.tone ?? "neutral"}>Quality: {QUALITY[t.qualityScore]?.label ?? t.qualityScore}</Badge> : null}
          {t.isDemo ? <Badge tone="info">Demo account</Badge> : null}
          {t.source === "meta_sync" ? <Badge>Imported from Meta</Badge> : null}
          <span className="ml-auto text-caption text-app-subtle">
            {t.submittedAt ? `Submitted ${dayFmt.format(new Date(t.submittedAt))}` : "Not submitted"}
            {t.reviewedAt ? ` · Reviewed ${dayFmt.format(new Date(t.reviewedAt))}` : ""}
          </span>
        </div>
        {t.status === "rejected" ? (
          <Alert tone="danger" title="Rejected by Meta">
            {t.rejectedReason || "No reason given."} Edit the template below and submit it again.
          </Alert>
        ) : null}
        {t.status === "paused" || t.status === "disabled" ? (
          <Alert tone="danger" title={`${STATUS_LABELS[t.status]}`}>{t.rejectedReason || "Customers blocked or reported this template. Meta stops it from sending."}</Alert>
        ) : null}
        {t.status === "pending" && !t.isDemo ? <Alert tone="info">Meta usually reviews within minutes to 24 hours. The status updates automatically.</Alert> : null}
        {t.status === "pending" && t.isDemo && canManage ? (
          <Alert tone="info" title="Demo review">
            Demo templates never reach Meta. Choose the review outcome to continue testing.
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={onApprove} loading={busy}>
                <CheckCircle2 aria-hidden="true" /> Approve (demo)
              </Button>
              <Button size="sm" variant="secondary" onClick={onReject} disabled={busy}>
                <XCircle aria-hidden="true" /> Reject (demo)
              </Button>
            </span>
          </Alert>
        ) : null}
        {t.status === "approved" && t.category !== "AUTHENTICATION" ? (
          <Link href="/campaigns" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Megaphone aria-hidden="true" /> Use in a campaign
          </Link>
        ) : null}
        {t.metaTemplateId ? <p className="text-caption text-app-subtle">Meta template ID: <span className="font-mono">{t.metaTemplateId}</span></p> : null}
      </CardBody>
    </Card>
  );
}

function RejectModal({ open, onClose, onReject, busy }: { open: boolean; onClose: () => void; onReject: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = React.useState("Variable format or promotional content in a utility template");
  return (
    <Modal open={open} onClose={onClose} title="Reject template (demo)" description="Simulates Meta rejecting the template, so you can test editing and resubmitting.">
      <div className="space-y-4">
        <Field id="rej-reason" label="Rejection reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onReject(reason)} loading={busy}>Reject</Button>
        </div>
      </div>
    </Modal>
  );
}

function DuplicateModal({ open, onClose, orgId, t }: { open: boolean; onClose: () => void; orgId: string; t: TemplateView }) {
  const router = useRouter();
  const [name, setName] = React.useState(`${t.name}_v2`);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ template: { id: string } }>(`/api/organizations/${orgId}/templates/${t.id}/duplicate`, { method: "POST", body: { name } });
    setBusy(false);
    if (!r.ok) return setError(r.details?.name?.[0] ?? r.error);
    onClose();
    router.push(`/templates/${r.data.template.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="Duplicate template" description="Creates an editable draft copy — the way to change an approved template.">
      <form onSubmit={submit} className="space-y-4">
        <Field id="dup-name" label="New template name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""))} className="font-mono" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name}>
            <Plus aria-hidden="true" /> Create copy
          </Button>
        </div>
      </form>
    </Modal>
  );
}
