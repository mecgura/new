"use client";

import * as React from "react";
import { Field, Input, Select, Textarea } from "@/components/ds";
import { LANGUAGES, POST_TYPES, TONES } from "@/lib/onepost";

export type PostFields = {
  title: string;
  brief: string;
  postType: string;
  language: string;
  tone: string;
  city: string;
  keywords: string;
  spokespersonName: string;
  spokespersonQuote: string;
  videoUrl: string;
};

export const EMPTY_POST: PostFields = { title: "", brief: "", postType: "general", language: "en", tone: "friendly", city: "", keywords: "", spokespersonName: "", spokespersonQuote: "", videoUrl: "" };

/** The idea behind a post. Shared by "New post" and the post editor. */
export function PostForm({ value, onChange, errors = {}, idPrefix = "op" }: { value: PostFields; onChange: (v: PostFields) => void; errors?: Record<string, string>; idPrefix?: string }) {
  const set = (k: keyof PostFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Field id={`${idPrefix}-title`} label="Title or idea" error={errors.title}>
        <Input value={value.title} onChange={set("title")} maxLength={140} placeholder="For example: Diwali offer on full-body checkups" />
      </Field>
      <Field id={`${idPrefix}-brief`} label="Details" hint="Dates, prices, place, who it is for. Only facts you write here are used. Nothing is made up." error={errors.brief}>
        <Textarea value={value.brief} onChange={set("brief")} maxLength={5000} rows={5} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${idPrefix}-type`} label="Post type" error={errors.postType}>
          <Select value={value.postType} onChange={set("postType")}>
            {POST_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${idPrefix}-lang`} label="Language" error={errors.language}>
          <Select value={value.language} onChange={set("language")}>
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${idPrefix}-tone`} label="Tone" error={errors.tone}>
          <Select value={value.tone} onChange={set("tone")}>
            {TONES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-city`} label="Target city" error={errors.city}>
          <Input value={value.city} onChange={set("city")} maxLength={80} placeholder="Shimla" />
        </Field>
        <Field id={`${idPrefix}-kw`} label="Keywords" hint="Separated by commas" error={errors.keywords}>
          <Input value={value.keywords} onChange={set("keywords")} maxLength={300} placeholder="health checkup, Shimla, Diwali offer" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-sp`} label="Spokesperson (for the press release)" error={errors.spokespersonName}>
          <Input value={value.spokespersonName} onChange={set("spokespersonName")} maxLength={120} placeholder="Name and title" />
        </Field>
        <Field id={`${idPrefix}-video`} label="Video link (optional)" hint="A YouTube or Drive link. Video file upload comes in a later phase." error={errors.videoUrl}>
          <Input value={value.videoUrl} onChange={set("videoUrl")} maxLength={300} placeholder="https://" inputMode="url" />
        </Field>
      </div>
      <Field id={`${idPrefix}-quote`} label="Quote (optional)" hint="Only words your spokesperson really said. MECGURA never makes up quotes." error={errors.spokespersonQuote}>
        <Textarea value={value.spokespersonQuote} onChange={set("spokespersonQuote")} maxLength={600} rows={3} />
      </Field>
    </div>
  );
}
