"use client";

import { limitLabel } from "@/lib/plans";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, LoadingState, PageHeader, Radio, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { SERVICES, formatINR, isComingSoon, type ServiceKey } from "@/lib/catalog";
import { generateClientPassword } from "@/components/admin/client-dialogs";

type Plan = { id: string; name: string; priceMonthly: number; isActive: boolean; maxUsers: number; maxWhatsAppNumbers: number; maxMonthlyMessages: number };

export default function NewClientPage() {
  const router = useRouter();
  const toast = useToast();
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [plansError, setPlansError] = React.useState("");
  const [form, setForm] = React.useState({
    name: "",
    ownerName: "",
    ownerEmail: "",
    mobile: "",
    ownerPassword: "",
    planId: "",
    status: "active" as "active" | "suspended",
    metaBillingMode: "client_pays" as "client_pays" | "prepaid_wallet",
    markupRupees: "0.20",
  });
  const [sendAgreement, setSendAgreement] = React.useState(true);
  const [services, setServices] = React.useState<ServiceKey[]>(["WHATSAPP_AUTOMATION"]);
  const [showPassword, setShowPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void apiFetch<{ plans: Plan[] }>("/api/admin/plans").then((r) => {
      if (!r.ok) return setPlansError(r.error);
      const active = r.data.plans.filter((p) => p.isActive);
      setPlans(active);
      if (active[0]) setForm((f) => (f.planId ? f : { ...f, planId: active[0].id }));
    });
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleService = (key: ServiceKey) => setServices((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const r = await apiFetch<{ organization: { id: string; name: string }; agreement: { whatsapp?: { sent: boolean; message: string }; email?: { sent: boolean; message: string } } | null }>("/api/admin/organizations", {
      method: "POST",
      body: { ...form, markupRupees: Number(form.markupRupees || 0), services, sendAgreement },
    });
    setSaving(false);
    if (!r.ok) {
      const d = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""]));
      setErrors({ ...d, form: r.details ? "Please fix the highlighted fields." : r.error });
      return;
    }
    const ag = r.data.agreement;
    if (sendAgreement && ag) {
      const wa = ag.whatsapp?.sent ? "WhatsApp ✓" : "WhatsApp not sent";
      const em = ag.email?.sent ? "email ✓" : "email not sent";
      toast(`${r.data.organization.name} created. Agreement: ${wa}, ${em}.`, ag.whatsapp?.sent && ag.email?.sent ? "success" : "error");
      router.push(`/admin/clients/${r.data.organization.id}?tab=agreement`);
      return;
    }
    toast(`${r.data.organization.name} created`);
    router.push(`/admin/clients/${r.data.organization.id}`);
  }

  const selectedPlan = plans?.find((p) => p.id === form.planId);

  return (
    <>
      <PageHeader
        title="Add client"
        description="Creates the client workspace, owner login, plan, default settings and services in one step."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Clients", href: "/admin/clients" }, { label: "Add client" }]}
      />
      {plansError ? <Alert tone="danger" className="mb-4">{plansError}</Alert> : null}
      {plans && plans.length === 0 ? (
        <Alert tone="warning" title="No active plans" className="mb-4">
          Create a plan in <Link href="/admin/billing" className="underline">Billing &amp; Plans</Link> before adding clients.
        </Alert>
      ) : null}
      <form onSubmit={submit} noValidate className="grid max-w-5xl gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
          <Card>
            <CardHeader title="Company" />
            <CardBody className="space-y-4">
              <Field id="name" label="Company name" error={errors.name}>
                <Input value={form.name} onChange={set("name")} placeholder="e.g. Jay Shri Enterprises" required />
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Owner login" description="The owner becomes CLIENT_OWNER of this workspace." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field id="ownerName" label="Owner name" error={errors.ownerName}>
                <Input value={form.ownerName} onChange={set("ownerName")} autoComplete="off" required />
              </Field>
              <Field id="ownerEmail" label="Email address" error={errors.ownerEmail}>
                <Input type="email" value={form.ownerEmail} onChange={set("ownerEmail")} placeholder="owner@company.com" autoComplete="off" required />
              </Field>
              <Field id="mobile" label="Mobile number" error={errors.mobile}>
                <Input type="tel" value={form.mobile} onChange={set("mobile")} placeholder="+91 98765 43210" autoComplete="off" />
              </Field>
              <div>
                <Field id="ownerPassword" label="Password" hint="Ignored if this email already has an account." error={errors.ownerPassword}>
                  <Input type={showPassword ? "text" : "password"} value={form.ownerPassword} onChange={set("ownerPassword")} autoComplete="new-password" className="font-mono" required />
                </Field>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setForm((f) => ({ ...f, ownerPassword: generateClientPassword() }));
                      setShowPassword(true);
                    }}
                  >
                    <Wand2 aria-hidden="true" /> Generate password
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />} {showPassword ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Enable services" description="Build this client's package: tick only what they pay for. Change any time from the client page." />
            <CardBody>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Services</legend>
                {SERVICES.filter((s) => !isComingSoon(s)).map((s) => (
                  <Checkbox key={s.key} label={s.label} description={s.description} checked={services.includes(s.key)} onChange={() => toggleService(s.key)} />
                ))}
              </fieldset>
              <p className="mb-2 mt-5 text-small font-semibold text-app-muted">Coming soon</p>
              <fieldset className="grid gap-3 opacity-70 sm:grid-cols-2" disabled>
                <legend className="sr-only">Services that are not available yet</legend>
                {SERVICES.filter(isComingSoon).map((s) => (
                  <Checkbox key={s.key} label={s.label} description={s.description.replace(/^Coming soon:\s*/, "")} checked={false} onChange={() => undefined} />
                ))}
              </fieldset>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Plan & status" />
            <CardBody className="space-y-4">
              {plans === null && !plansError ? (
                <LoadingState className="py-4" label="Loading plans…" />
              ) : (
                <Field id="planId" label="Select plan" error={errors.planId}>
                  <Select value={form.planId} onChange={set("planId")} required disabled={!plans?.length}>
                    {plans?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatINR(p.priceMonthly)}/mo
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {selectedPlan ? (
                <ul className="space-y-1 text-small text-app-muted">
                  <li>{limitLabel(selectedPlan.maxUsers)} team seats</li>
                  <li>{limitLabel(selectedPlan.maxWhatsAppNumbers)} WhatsApp number(s)</li>
                  <li>{limitLabel(selectedPlan.maxMonthlyMessages)} messages / month</li>
                </ul>
              ) : null}
              <Field id="status" label="Status" hint={form.status === "suspended" ? "Owner can't access the workspace until activated." : undefined}>
                <Select value={form.status} onChange={set("status")}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </Select>
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Meta billing type" description="Who pays Meta for this client's WhatsApp messages. Change any time from the client's Wallet tab." />
            <CardBody className="space-y-3">
              <Radio
                name="metaBillingMode"
                checked={form.metaBillingMode === "client_pays"}
                onChange={() => setForm((f) => ({ ...f, metaBillingMode: "client_pays" }))}
                label="Client pays Meta"
                description="Client adds their own card in Meta Billing. No risk for you."
              />
              <Radio
                name="metaBillingMode"
                checked={form.metaBillingMode === "prepaid_wallet"}
                onChange={() => setForm((f) => ({ ...f, metaBillingMode: "prepaid_wallet" }))}
                label="Prepaid wallet"
                description="Your card on their WhatsApp account; client recharges the MECGURA wallet at Meta rate + your markup."
              />
              {form.metaBillingMode === "prepaid_wallet" ? (
                <Field id="markupRupees" label="Your markup per message (₹)" error={errors.markupRupees} hint="Set a low-balance alert in the Wallet tab after creating.">
                  <Input inputMode="decimal" value={form.markupRupees} onChange={(e) => setForm((f) => ({ ...f, markupRupees: e.target.value.replace(/[^\d.]/g, "") }))} className="w-32" />
                </Field>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Checkbox
                checked={sendAgreement}
                onChange={(e) => setSendAgreement(e.target.checked)}
                label="Send service agreement"
                description="Creates the agreement and sends the link on WhatsApp + email, so the client can check details, upload business proof and sign."
              />
            </CardBody>
          </Card>
          <div className="flex gap-2">
            <Button type="submit" size="lg" className="flex-1" loading={saving} disabled={!plans?.length}>
              Create client
            </Button>
            <Link href="/admin/clients" className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-app-border px-4 text-body text-app-text hover:bg-app-hover">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
