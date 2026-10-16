"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, Globe, Mail, MonitorSmartphone, UserRound } from "lucide-react";
import { BrandPreview, ContrastList } from "@/components/clinic/brand-preview";
import { ColorFields } from "@/components/clinic/color-fields";
import { Logo } from "@/components/brand/logo";
import { Alert, Button, Card, CardBody, CardHeader, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { brandContrastIssues } from "@/theme/contrast";
import { brandToCssVars, type BrandColors } from "@/theme/tokens";

const scope = (b: BrandColors) => brandToCssVars(b) as React.CSSProperties;

/** Edit a clinic's colours with a live preview of every surface. NOTHING is saved until "Save branding"; the server re-validates contrast. */
export function BrandingManager({ clinicId, name, initial, logoUrl }: { clinicId: string; name: string; initial: BrandColors; logoUrl: string | null }) {
  const router = useRouter(); const toast = useToast();
  const [brand, setBrand] = useState(initial); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const dirty = (["primary", "secondary", "accent"] as const).some((k) => brand[k] !== initial[k]); const issues = brandContrastIssues(brand);
  async function save() {
    setBusy(true); const res = await apiFetch(`/api/platform/clinics/${clinicId}/branding`, { method: "PUT", body: JSON.stringify({ primaryColor: brand.primary, secondaryColor: brand.secondary, accentColor: brand.accent }) }); setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save branding", description: res.error.message }); }
    setErrors({}); toast({ tone: "success", title: "Branding saved" }); router.refresh();
  }
  return (
    <div className="space-y-section">
      <Card>
        <CardHeader title="Colours" description="Preview first — nothing changes for the clinic until you save." />
        <CardBody className="space-y-4">
          <ColorFields value={brand} onChange={setBrand} errors={errors} />
          <ContrastList brand={brand} />
          {Object.keys(issues).length > 0 && <Alert tone="warning" title="Some colours are hard to read">The server will refuse to save colours below the readable-contrast minimum.</Alert>}
          <div className="flex flex-wrap gap-2"><Button onClick={save} loading={busy} disabled={!dirty}>Save branding</Button><Button variant="outline" onClick={() => { setBrand(initial); setErrors({}); }} disabled={!dirty}>Discard changes</Button></div>
          <p className="type-caption">Logo and favicon are uploaded by the clinic in its own Settings → Branding (or by you inside a support-access visit).</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Preview" description="The same design tokens the real screens use, with the colours above." />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <Surface icon={<MonitorSmartphone aria-hidden className="size-4" />} title="Staff dashboard"><BrandPreview brand={brand} name={name} logoUrl={logoUrl} /></Surface>
          <Surface icon={<UserRound aria-hidden className="size-4" />} title="Login page">
            <div className="brand-scope rounded-lg border border-line bg-surface p-4" style={scope(brand)}><Logo name={name} sub={null} logoUrl={logoUrl} className="mb-4" /><p className="type-card-title">Welcome back</p><div className="mt-3 space-y-2"><div className="h-9 rounded-md border border-line-strong bg-app" /><div className="h-9 rounded-md border border-line-strong bg-app" /><span className="inline-flex h-9 items-center rounded-md bg-btn px-4 text-sm font-medium text-on-brand">Sign in</span></div></div>
          </Surface>
          <Surface icon={<Globe aria-hidden className="size-4" />} title="Public website & patient portal">
            <div className="brand-scope overflow-hidden rounded-lg border border-line bg-surface" style={scope(brand)}><div className="flex items-center justify-between border-b border-line px-3 py-2"><Logo name={name} sub={null} logoUrl={logoUrl} /><span className="text-sm font-medium text-primary">Patient portal</span></div><div className="bg-primary-soft p-4"><p className="type-card-title">Book an appointment with {name}</p><span className="mt-2 inline-flex h-9 items-center rounded-md bg-btn px-4 text-sm font-medium text-on-brand">Book now</span></div></div>
          </Surface>
          <Surface icon={<Mail aria-hidden className="size-4" />} title="Email">
            <div className="brand-scope overflow-hidden rounded-lg border border-line bg-surface" style={scope(brand)}><div className="bg-primary px-4 py-3 text-on-brand"><p className="font-semibold">{name}</p></div><div className="space-y-2 p-4"><p className="type-body">Your appointment is confirmed.</p><span className="inline-flex h-9 items-center rounded-md bg-btn px-4 text-sm font-medium text-on-brand">View details</span></div></div>
          </Surface>
          <Surface icon={<Bell aria-hidden className="size-4" />} title="Notification">
            <div className="brand-scope flex items-start gap-3 rounded-lg border border-line bg-surface p-3" style={scope(brand)}><span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" /><div><p className="type-label">New appointment — {name}</p><p className="type-caption">Today · 10:30 · Open</p></div></div>
          </Surface>
        </CardBody>
      </Card>
    </div>
  );
}
function Surface({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section aria-label={`${title} preview`}><h3 className="type-label mb-2 flex items-center gap-2">{icon}{title}</h3>{children}</section>;
}
