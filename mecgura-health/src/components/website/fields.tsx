/* eslint-disable @next/next/no-img-element -- previews of our own uploaded images */
"use client";
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Field, NumberInput, Select, TextInput, Textarea, Toggle, DatePicker, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export type FieldDef = {
  name: string; label: string; hint?: string; span?: 2; required?: boolean; placeholder?: string; rows?: number; max?: number;
  type: "text" | "textarea" | "markdown" | "number" | "select" | "toggle" | "image" | "lines" | "date" | "url";
  options?: { value: string; label: string }[];
};
export type Values = Record<string, unknown>;

export const getPath = (o: Values, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Values)[k] : undefined), o);
export function setPath(o: Values, path: string, v: unknown): Values {
  const [head, ...rest] = path.split(".");
  return { ...o, [head]: rest.length ? setPath(((o[head] as Values) ?? {}) as Values, rest.join("."), v) : v };
}

/** Upload an image through the CMS and report its URL. */
export function ImageField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (url: string) => void; error?: string; hint?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    const body = new FormData(); body.append("file", file);
    const res = await apiFetch<{ url: string }>("/api/website/images", { method: "POST", body });
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't upload image", description: res.error.fieldErrors?.file ?? res.error.message });
    onChange(res.data.url);
  }
  return (
    <Field label={label} error={error} hint={hint ?? "PNG, JPG or WebP up to 4 MB. It is resized and optimised automatically."}>
      <div className="flex flex-wrap items-center gap-3">
        {value ? <img src={value} alt="" className="size-20 rounded-md border border-line object-cover" /> : <span aria-hidden className="flex size-20 items-center justify-center rounded-md border border-dashed border-line-strong text-muted"><ImagePlus className="size-6" /></span>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`Choose ${label}`} onChange={(e) => void upload(e.target.files?.[0])} />
        <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}>{value ? "Replace" : "Upload"}</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}><Trash2 aria-hidden className="size-4" />Remove</Button>}
      </div>
    </Field>
  );
}

/** Config-driven field set. Names may be dotted ("social.facebook"). */
export function FieldsForm({ fields, value, onChange, errors = {}, prefix = "" }: { fields: FieldDef[]; value: Values; onChange: (v: Values) => void; errors?: Record<string, string>; prefix?: string }) {
  const set = (name: string, v: unknown) => onChange(setPath(value, name, v));
  return (
    <div className="grid gap-form md:grid-cols-2">
      {fields.map((f) => {
        const v = getPath(value, f.name);
        const err = errors[`${prefix}${f.name}`];
        const span = f.span === 2 || f.type === "markdown" || f.type === "textarea" || f.type === "lines" || f.type === "image" || f.type === "toggle" ? "md:col-span-2" : "";
        if (f.type === "toggle") return <div key={f.name} className={span}><Toggle label={f.label} checked={!!v} onChange={(x) => set(f.name, x)} />{f.hint && <p className="type-caption ml-14">{f.hint}</p>}</div>;
        if (f.type === "image") return <div key={f.name} className={span}><ImageField label={f.label} value={(v as string) ?? ""} onChange={(u) => set(f.name, u)} error={err} hint={f.hint} /></div>;
        const hint = f.type === "markdown" ? `${f.hint ? f.hint + " · " : ""}Formatting: ## heading, **bold**, *italic*, - list, [link](https://…). HTML is not allowed.` : f.hint;
        return (
          <Field key={f.name} label={f.label} required={f.required} error={err} hint={hint} className={span}>
            {f.type === "textarea" || f.type === "markdown" ? <Textarea rows={f.rows ?? (f.type === "markdown" ? 8 : 4)} maxLength={f.max} value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
              : f.type === "lines" ? <Textarea rows={f.rows ?? 4} value={((v as string[]) ?? []).join("\n")} onChange={(e) => set(f.name, e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} placeholder={f.placeholder ?? "One per line"} />
              : f.type === "number" ? <NumberInput value={(v as string | number) ?? ""} onChange={(e) => set(f.name, e.target.value)} min={0} step={1} />
              : f.type === "date" ? <DatePicker value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} />
              : f.type === "select" ? <Select value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} options={f.options ?? []} placeholder="Not set" />
              : <TextInput type={f.type === "url" ? "url" : "text"} value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} maxLength={f.max} placeholder={f.placeholder} />}
          </Field>
        );
      })}
    </div>
  );
}
