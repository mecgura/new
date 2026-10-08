/* eslint-disable @next/next/no-img-element -- tenant-uploaded images are served by our own /api/assets route */
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog, FileUpload, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { brandContrastIssues } from "@/theme/contrast";
import { DEFAULT_BRAND, type BrandColors } from "@/theme/tokens";
import { BrandPreview, ContrastList } from "./brand-preview";
import { ColorFields } from "./color-fields";

interface Props { clinicName: string; initial: BrandColors; logoUrl: string | null; faviconUrl: string | null; canEdit: boolean }

export function BrandingEditor({ clinicName, initial, logoUrl, faviconUrl, canEdit }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [brand, setBrand] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const issues = brandContrastIssues(brand);
  const dirty = (["primary", "secondary", "accent"] as const).some((k) => brand[k] !== initial[k]);

  async function save() {
    setBusy(true);
    const res = await apiFetch("/api/clinic/branding", { method: "PATCH", body: JSON.stringify({ primaryColor: brand.primary, secondaryColor: brand.secondary, accentColor: brand.accent }) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save branding", description: res.error.message }); }
    setErrors({}); toast({ tone: "success", title: "Branding saved" }); router.refresh();
  }
  async function reset() {
    setBusy(true);
    const res = await apiFetch("/api/clinic/branding", { method: "DELETE" });
    setBusy(false); setConfirmReset(false);
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't reset", description: res.error.message });
    setBrand({ ...DEFAULT_BRAND }); toast({ tone: "success", title: "Branding reset to the MECGURA default" }); router.refresh();
  }
  async function upload(kind: "logo" | "favicon", files: File[]) {
    const file = files[0];
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    const res = await apiFetch(`/api/clinic/branding/${kind}`, { method: "POST", body });
    if (!res.ok) return toast({ tone: "danger", title: `Couldn't upload the ${kind}`, description: res.error.fieldErrors?.file ?? res.error.message });
    toast({ tone: "success", title: `${kind === "logo" ? "Logo" : "Favicon"} updated` }); router.refresh();
  }
  async function remove(kind: "logo" | "favicon") {
    const res = await apiFetch(`/api/clinic/branding/${kind}`, { method: "DELETE" });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't remove", description: res.error.message });
    toast({ tone: "success", title: "Removed" }); router.refresh();
  }

  return (
    <div className="space-y-section">
      {!canEdit && <Alert tone="info" title="View only">Only a Clinic Admin can change branding.</Alert>}
      <Card>
        <CardHeader title="Colours" description="Only these three colours are customisable; everything else stays on the MECGURA design system." />
        <CardBody className="space-y-section">
          <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-section"><ColorFields value={brand} onChange={setBrand} errors={errors} /></fieldset>
          <ContrastList brand={brand} />
          {Object.keys(issues).length > 0 && <Alert tone="warning" title="Some colours are too light to read">Buttons use white text. Pick darker shades to enable saving.</Alert>}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} loading={busy} disabled={!dirty || Object.keys(issues).length > 0}>Save</Button>
              <Button variant="outline" disabled={!dirty || busy} onClick={() => { setBrand(initial); setErrors({}); }}>Cancel</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)}>Reset to default</Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Preview" description="Updates live as you change colours. Nothing is applied until you save." />
        <CardBody><BrandPreview brand={brand} name={clinicName} logoUrl={logoUrl} /></CardBody>
      </Card>

      <Card>
        <CardHeader title="Logo & favicon" description="PNG, JPG or WebP. Logo up to 512 KB, favicon up to 128 KB. SVG is not accepted." />
        <CardBody className="grid gap-section md:grid-cols-2">
          {([["logo", "Logo", logoUrl], ["favicon", "Favicon", faviconUrl]] as const).map(([kind, label, url]) => (
            <div key={kind} className="space-y-3">
              <p className="type-label">{label}</p>
              {url ? <div className="flex items-center gap-3"><img src={url} alt={`${label} preview`} className="size-16 rounded-md border border-line object-contain" />{canEdit && <Button size="sm" variant="outline" onClick={() => remove(kind)}>Remove</Button>}</div> : <p className="type-caption">None uploaded — the MECGURA mark is used.</p>}
              {canEdit && <FileUpload key={url ?? "none"} label={`Choose ${label.toLowerCase()}`} accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" maxSizeMB={kind === "logo" ? 0.5 : 0.125} hint={kind === "logo" ? "PNG, JPG or WebP · up to 512 KB" : "PNG, JPG or WebP · up to 128 KB"} onFilesChange={(f) => void upload(kind, f)} />}
            </div>
          ))}
        </CardBody>
      </Card>
      <ConfirmDialog open={confirmReset} onCancel={() => setConfirmReset(false)} onConfirm={reset} loading={busy} title="Reset colours to default?" description="Your clinic goes back to the standard MECGURA colours. The logo and favicon are kept." confirmLabel="Reset" tone="primary" />
    </div>
  );
}
