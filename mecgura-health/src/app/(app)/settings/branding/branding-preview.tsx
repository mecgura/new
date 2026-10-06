"use client";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, StatusBadge, TextInput } from "@/components/ui";
import { Logo } from "@/components/brand/logo";
import { brandToCssVars, DEFAULT_BRAND, type BrandColors } from "@/theme/tokens";

const HEX = /^#[0-9a-f]{6}$/i;

/** Local-only theme try-out: overrides --brand-* on a `.brand-scope` wrapper. Nothing is persisted. */
export function BrandingPreview({ initial }: { initial: BrandColors }) {
  const [brand, setBrand] = useState<BrandColors>(initial);
  const set = (k: keyof BrandColors) => (v: string) => HEX.test(v) && setBrand((b) => ({ ...b, [k]: v.toLowerCase() }));

  return (
    <Card>
      <CardHeader title="Try a clinic theme" action={<Button variant="outline" size="sm" onClick={() => setBrand({ ...DEFAULT_BRAND })}>Reset to default</Button>} />
      <CardBody className="space-y-section">
        <div className="grid gap-form sm:grid-cols-3">
          {(["primary", "secondary", "accent"] as const).map((k) => (
            <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} colour`}>
              <input type="color" value={brand[k]} onChange={(e) => set(k)(e.target.value)} className="h-control w-full cursor-pointer rounded-md border border-line-strong bg-surface p-1" />
            </Field>
          ))}
        </div>

        <div className="brand-scope rounded-lg border border-line bg-app p-card" style={brandToCssVars(brand) as React.CSSProperties}>
          <p className="type-caption mb-3">Preview (not saved)</p>
          <div className="flex flex-col gap-4">
            <Logo name="Your Clinic" sub={null} />
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="success">Success</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">Primary</Badge><StatusBadge tone="success">Completed</StatusBadge><StatusBadge tone="emergency">Emergency</StatusBadge></div>
            <div className="max-w-xs"><Field label="Sample input"><TextInput placeholder="Focus me to see the ring" /></Field></div>
            <Alert tone="info" title="Semantic colours stay fixed">Success, warning, danger and emergency never change with the theme, so their meaning stays consistent.</Alert>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
