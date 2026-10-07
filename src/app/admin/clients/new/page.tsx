"use client";

import { limitLabel } from "@/lib/plans";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, LoadingState, PageHeader, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { SERVICES, formatINR, type ServiceKey } from "@/lib/catalog";
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
  });
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
    const r = await apiFetch<{ organization: { id: string; name: string } }>("/api/admin/organizations", { method: "POST", body: { ...form, services } });
    setSaving(false);
    if (!r.ok) {
      const d = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""]));
      setErrors({ ...d, form: r.details ? "Please fix the highlighted fields." : r.error });
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
            <CardHeader title="Enable services" description="Modules this client can use. Change any time from the client page." />
            <CardBody>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Services</legend>
                {SERVICES.map((s) => (
                  <Checkbox key={s.key} label={s.label} description={s.description} checked={services.includes(s.key)} onChange={() => toggleService(s.key)} />
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
