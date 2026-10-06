import type { Metadata } from "next";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { DEFAULT_BRAND, resolveBrandColors } from "@/theme/tokens";
import { BrandingPreview } from "./branding-preview";

export const metadata: Metadata = { title: "Theme & branding" };

export default async function BrandingPage() {
  const ctx = await requirePagePermission("settings.view");
  const current = ctx.tenant?.brand ?? resolveBrandColors();
  return (
    <div className="space-y-section">
      <Alert tone="info" title="Preview only">
        White-label branding is stored per clinic and applied to the whole app. The editor to save it arrives in a later phase; here you can try colours to see how a clinic theme will look. Nothing on this page is saved.
      </Alert>
      <Card>
        <CardHeader title="Active theme" description={ctx.tenant ? `Colours in use for ${ctx.tenant.name}` : "Platform default theme"} />
        <CardBody className="flex flex-wrap gap-4">
          {(["primary", "secondary", "accent"] as const).map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span aria-hidden className="size-10 rounded-lg border border-line" style={{ background: current[k] }} />
              <div><p className="type-label capitalize">{k}</p><p className="type-caption font-mono">{current[k]}{current[k] === DEFAULT_BRAND[k] ? " (default)" : ""}</p></div>
            </div>
          ))}
        </CardBody>
      </Card>
      <BrandingPreview initial={current} />
    </div>
  );
}
