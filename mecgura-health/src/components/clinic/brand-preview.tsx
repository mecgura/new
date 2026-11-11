"use client";
import { Building2, Check, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, CardBody, StatusBadge } from "@/components/ui";
import { Logo } from "@/components/brand/logo";
import { contrastRatio } from "@/theme/contrast";
import { brandToCssVars, type BrandColors } from "@/theme/tokens";

/** Shows how a clinic theme renders (header, button, badge, card) using a scoped copy of the real tokens. */
export function BrandPreview({ brand, name, logoUrl }: { brand: BrandColors; name: string; logoUrl?: string | null }) {
  return (
    <div className="brand-scope overflow-hidden rounded-lg border border-line bg-app" style={brandToCssVars(brand) as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5">
        <Logo name={name || "Your clinic"} sub={null} logoUrl={logoUrl} />
        <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm sm:flex"><Building2 aria-hidden className="size-4 text-muted" />Workspace</span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <Card><CardBody className="space-y-3">
          <p className="type-card-title">Card heading</p>
          <p className="type-secondary">Buttons, badges and links use your colours.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm">Primary</Button><Button size="sm" variant="secondary">Secondary</Button><Button size="sm" variant="outline">Outline</Button></div>
          <div className="flex flex-wrap gap-2"><Badge tone="primary">Primary</Badge><StatusBadge tone="success">Completed</StatusBadge><StatusBadge tone="emergency">Emergency</StatusBadge></div>
        </CardBody></Card>
        <Card><CardBody className="space-y-2">
          <div className="flex items-center gap-2"><span aria-hidden className="size-6 rounded-md bg-accent" /><span className="type-label">Accent highlight</span></div>
          <p className="type-caption">Semantic colours (success, warning, danger, emergency) never change with the theme.</p>
          <a href="#preview" onClick={(e) => e.preventDefault()} className="type-label underline">Sample link</a>
        </CardBody></Card>
      </div>
    </div>
  );
}

/** Per-colour accessibility readout: contrast against white text/background. */
export function ContrastList({ brand }: { brand: BrandColors }) {
  const rows = [
    { k: "primary", label: "Primary", need: 4.5 },
    { k: "secondary", label: "Secondary", need: 4.5 },
    { k: "accent", label: "Accent", need: 3 },
  ] as const;
  return (
    <ul className="grid gap-2 sm:grid-cols-3" aria-label="Colour contrast checks">
      {rows.map(({ k, label, need }) => {
        const ratio = contrastRatio(brand[k], "#ffffff");
        const ok = ratio >= need;
        return (
          <li key={k} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
            {ok ? <Check aria-hidden className="size-4 text-success" /> : <TriangleAlert aria-hidden className="size-4 text-danger" />}
            <span className="type-caption !text-ink">{label}: {ratio.toFixed(1)}:1 <span className={ok ? "text-success" : "text-danger"}>{ok ? "readable" : `needs ${need}:1`}</span></span>
          </li>
        );
      })}
    </ul>
  );
}
