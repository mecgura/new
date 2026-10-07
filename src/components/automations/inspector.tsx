"use client";

import * as React from "react";
import { Copy, KeyRound, Plus, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, IconButton, Input, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import {
  CONDITION_FIELDS,
  CONDITION_FIELD_LABELS,
  CONSENT_VALUES,
  LEAD_STATUS_VALUES,
  NODE_LABELS,
  OPERATORS_FOR,
  OPERATOR_LABELS,
  SOURCE_VALUES,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  type ConditionField,
  type FlowNode,
  type NodeDataMap,
  type TriggerData,
  type TriggerType,
  type VariableMap,
} from "@/lib/automations";
import type { Slot } from "@/lib/templates";

export type TemplateOption = { id: string; name: string; language: string; category: string; slots: Slot[]; numbers: string[] };
export type Lists = {
  templates: TemplateOption[];
  members: { userId: string; name: string; role: string }[];
  tags: string[];
  accounts: { id: string; displayName: string; phoneNumber: string; isDemo: boolean }[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VARIABLE_HELP = "Personalise with {{contact.first_name}}, {{contact.name}}, {{contact.phone}}, {{contact.custom.city}}, {{reply}} (the customer's last answer) or {{ai.response}}.";

function TagInput({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; tags?: string[]; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint ?? "Pick an existing tag or type a new one."}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} list={`${id}-list`} maxLength={40} />
    </Field>
  );
}

function TagDatalist({ id, tags }: { id: string; tags: string[] }) {
  return (
    <datalist id={`${id}-list`}>
      {tags.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

/** Config form for the selected step. Every change is applied immediately (and is undoable). */
export function NodeInspector({ node, onChange, onDelete, lists, readOnly, webhook }: { node: FlowNode; onChange: (data: FlowNode["data"]) => void; onDelete: () => void; lists: Lists; readOnly: boolean; webhook: React.ReactNode }) {
  const d = node.data as Record<string, unknown> & { label?: string };
  const set = (patch: Record<string, unknown>) => onChange({ ...(node.data as object), ...patch } as FlowNode["data"]);
  const fid = (k: string) => `in-${node.id}-${k}`;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="primary">{NODE_LABELS[node.type]}</Badge>
        {node.type !== "trigger" && !readOnly ? (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 aria-hidden="true" /> Delete step
          </Button>
        ) : null}
      </div>
      <Field id={fid("label")} label="Step name" hint="Shown on the canvas and in logs.">
        <Input value={d.label ?? ""} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder={NODE_LABELS[node.type]} />
      </Field>
      {node.type === "trigger" ? <TriggerForm d={node.data as TriggerData} set={set} lists={lists} fid={fid} webhook={webhook} /> : null}
      {node.type === "message" ? <MessageForm d={node.data as NodeDataMap["message"]} set={set} lists={lists} fid={fid} /> : null}
      {node.type === "template" ? <TemplateForm d={node.data as NodeDataMap["template"]} set={set} lists={lists} fid={fid} /> : null}
      {node.type === "delay" ? <DelayForm d={node.data as NodeDataMap["delay"]} set={set} fid={fid} /> : null}
      {node.type === "condition" ? <ConditionForm d={node.data as NodeDataMap["condition"]} set={set} lists={lists} fid={fid} /> : null}
      {node.type === "tag" ? (
        <>
          <Field id={fid("action")} label="Action">
            <Select value={String(d.action)} onChange={(e) => set({ action: e.target.value })}>
              <option value="add">Add tag</option>
              <option value="remove">Remove tag</option>
            </Select>
          </Field>
          <TagInput id={fid("tag")} label="Tag" value={String(d.tagName ?? "")} onChange={(v) => set({ tagName: v })} tags={lists.tags} />
          <TagDatalist id={fid("tag")} tags={lists.tags} />
        </>
      ) : null}
      {node.type === "assign" ? (
        <>
          <Field id={fid("mode")} label="Assign to">
            <Select value={String(d.mode)} onChange={(e) => set({ mode: e.target.value })}>
              <option value="auto">Least busy agent (online first)</option>
              <option value="user">A specific person</option>
            </Select>
          </Field>
          {d.mode === "user" ? (
            <Field id={fid("user")} label="Team member">
              <Select value={String(d.userId ?? "")} onChange={(e) => set({ userId: e.target.value })}>
                <option value="">Choose…</option>
                {lists.members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name} ({m.role.toLowerCase().replace("client_", "")})</option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-caption text-app-muted">Picks an agent who is online with the fewest open chats; falls back to managers. The person gets a notification.</p>
          )}
        </>
      ) : null}
      {node.type === "update_contact" ? <UpdateForm d={node.data as NodeDataMap["update_contact"]} set={set} fid={fid} /> : null}
      {node.type === "webhook" ? (
        <>
          <Field id={fid("url")} label="Webhook URL (https)" hint="We POST the contact, trigger and latest reply as JSON. Internal / private addresses are blocked.">
            <Input value={String(d.url ?? "")} onChange={(e) => set({ url: e.target.value.trim() })} placeholder="https://hooks.zapier.com/…" />
          </Field>
          <OnErrorField value={String(d.onError)} onChange={(v) => set({ onError: v })} id={fid("err")} />
          <p className="text-caption text-app-subtle">Timeouts, 429 and 5xx answers are retried up to 3 times (1, 5, 15 min) with the same <code>X-Mecgura-Idempotency-Key</code>.</p>
        </>
      ) : null}
      {node.type === "ai_response" ? (
        <>
          <Field id={fid("ins")} label="Instructions for the AI" hint="Facts it may use (services, hours, prices) and the tone. It won't invent anything else.">
            <Textarea value={String(d.instructions ?? "")} onChange={(e) => set({ instructions: e.target.value })} rows={6} maxLength={4000} />
          </Field>
          <Checkbox label="Send the reply to the customer" checked={Boolean(d.sendReply)} onChange={(e) => set({ sendReply: e.target.checked })} />
          <Field id={fid("save")} label="Also save the reply to custom field (optional)">
            <Input value={String(d.saveToField ?? "")} onChange={(e) => set({ saveToField: e.target.value })} placeholder="ai_summary" maxLength={40} />
          </Field>
          <OnErrorField value={String(d.onError)} onChange={(v) => set({ onError: v })} id={fid("err")} />
          <Alert tone="info">Uses Claude (Anthropic). Needs <code>ANTHROPIC_API_KEY</code> on the server; without it this step fails with a clear message in the logs.</Alert>
        </>
      ) : null}
      {node.type === "end" ? <p className="text-small text-app-muted">The run finishes here.</p> : null}
    </fieldset>
  );
}

function OnErrorField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <Field id={id} label="If this step fails">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="stop">Stop the automation</option>
        <option value="continue">Continue to the next step</option>
      </Select>
    </Field>
  );
}

type FormProps<T> = { d: T; set: (p: Record<string, unknown>) => void; fid: (k: string) => string };

function TriggerForm({ d, set, lists, fid, webhook }: FormProps<TriggerData> & { lists: Lists; webhook: React.ReactNode }) {
  return (
    <>
      <Field id={fid("trigger")} label="Start when">
        <Select value={d.trigger} onChange={(e) => set({ trigger: e.target.value as TriggerType })}>
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </Select>
      </Field>
      {d.trigger === "new_contact" ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-small font-medium text-app-text">Contacts created from</legend>
          {SOURCE_VALUES.map((s) => (
            <Checkbox
              key={s}
              label={s === "whatsapp" ? "WhatsApp (customer messaged you)" : s === "manual" ? "Added manually" : s === "import" ? "CSV import" : "API / webhook"}
              checked={d.sources.includes(s)}
              onChange={(e) => set({ sources: e.target.checked ? [...d.sources, s] : d.sources.filter((x) => x !== s) })}
            />
          ))}
          <p className="text-caption text-app-subtle">CSV imports are off by default so a big import doesn&apos;t message thousands of people at once.</p>
        </fieldset>
      ) : null}
      {d.trigger === "keyword" ? (
        <>
          <Field id={fid("kw")} label="Keywords" hint="Comma separated, not case-sensitive.">
            <Input value={d.keywords.join(", ")} onChange={(e) => set({ keywords: e.target.value.split(",").map((x) => x.trimStart()).slice(0, 30) })} placeholder="price, menu, offer" />
          </Field>
          <Field id={fid("match")} label="Match">
            <Select value={d.match} onChange={(e) => set({ match: e.target.value })}>
              <option value="exact">Whole message equals a keyword</option>
              <option value="contains">Message contains a keyword</option>
              <option value="starts_with">Message starts with a keyword</option>
            </Select>
          </Field>
        </>
      ) : null}
      {d.trigger === "button_click" ? (
        <Field id={fid("btn")} label="Button text (optional)" hint="Leave empty for any button.">
          <Input value={d.buttonText} onChange={(e) => set({ buttonText: e.target.value })} maxLength={40} />
        </Field>
      ) : null}
      {d.trigger === "template_reply" ? (
        <Field id={fid("tpl")} label="Replies to template (optional)">
          <Select value={d.templateId} onChange={(e) => set({ templateId: e.target.value })}>
            <option value="">Any template</option>
            {lists.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
            ))}
          </Select>
        </Field>
      ) : null}
      {d.trigger === "tag_added" ? (
        <>
          <TagInput id={fid("tag")} label="Tag" value={d.tagName} onChange={(v) => set({ tagName: v })} tags={lists.tags} hint="Runs when this tag is added to a contact." />
          <TagDatalist id={fid("tag")} tags={lists.tags} />
        </>
      ) : null}
      {d.trigger === "lead_status" ? (
        <Field id={fid("ls")} label="New lead status">
          <Select value={d.leadStatus} onChange={(e) => set({ leadStatus: e.target.value })} className="capitalize">
            <option value="">Any change</option>
            {LEAD_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      {d.trigger === "schedule" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid("freq")} label="Repeat">
              <Select value={d.schedule.frequency} onChange={(e) => set({ schedule: { ...d.schedule, frequency: e.target.value } })}>
                <option value="daily">Every day</option>
                <option value="weekly">On weekdays…</option>
              </Select>
            </Field>
            <Field id={fid("time")} label="Time (IST)">
              <Input type="time" value={d.schedule.time} onChange={(e) => set({ schedule: { ...d.schedule, time: e.target.value } })} />
            </Field>
          </div>
          {d.schedule.frequency === "weekly" ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((w, i) => {
                const on = d.schedule.days.includes(i);
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ schedule: { ...d.schedule, days: on ? d.schedule.days.filter((x) => x !== i) : [...d.schedule.days, i].sort() } })}
                    className={on ? "rounded-full border border-app-primary bg-app-primary-soft px-2.5 py-1 text-caption" : "rounded-full border border-app-border px-2.5 py-1 text-caption text-app-muted"}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          ) : null}
          <TagInput id={fid("stag")} label="For contacts tagged" value={d.schedule.tagName} onChange={(v) => set({ schedule: { ...d.schedule, tagName: v } })} tags={lists.tags} hint="Runs once per contact with this tag (max 1,000 per run). Opted-out and suppressed contacts are skipped." />
          <TagDatalist id={fid("stag")} tags={lists.tags} />
        </>
      ) : null}
      {d.trigger === "flow_submission" ? <p className="text-caption text-app-muted">Runs when a customer submits a WhatsApp Flow (form). The submitted fields are available to webhook steps.</p> : null}
      {d.trigger === "incoming_message" ? <p className="text-caption text-app-muted">Runs on every customer message — combine with a Condition to filter. Messages that answer a waiting automation don&apos;t start new runs.</p> : null}
      {d.trigger === "webhook" ? webhook : null}
    </>
  );
}

function MessageForm({ d, set, lists, fid }: FormProps<NodeDataMap["message"]> & { lists: Lists }) {
  return (
    <>
      <Field id={fid("text")} label={<span className="flex justify-between">Message <span className="text-caption text-app-subtle">{d.text.length}/1024</span></span>} hint={VARIABLE_HELP}>
        <Textarea value={d.text} onChange={(e) => set({ text: e.target.value })} rows={5} maxLength={1024} />
      </Field>
      <div>
        <p className="mb-1.5 text-small font-medium text-app-text">Reply buttons (up to 3)</p>
        <ul className="space-y-2">
          {d.buttons.map((b, i) => (
            <li key={i} className="flex gap-2">
              <Input aria-label={`Button ${i + 1}`} value={b} maxLength={20} onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? e.target.value : x)) })} />
              <IconButton label={`Remove button ${i + 1}`} onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })}>
                <X aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
        {d.buttons.length < 3 ? (
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => set({ buttons: [...d.buttons, ""] })}>
            <Plus aria-hidden="true" /> Add button
          </Button>
        ) : null}
      </div>
      <Checkbox label="Wait for the customer's reply" description="The next step can check the answer with a Condition (“Customer's message”)." checked={d.waitForReply} onChange={(e) => set({ waitForReply: e.target.checked })} />
      {d.waitForReply ? (
        <Field id={fid("timeout")} label="Stop waiting after (minutes)" hint="1 minute – 7 days. After that the flow continues with an empty answer.">
          <Input type="number" min={1} max={10080} value={d.replyTimeoutMinutes} onChange={(e) => set({ replyTimeoutMinutes: Number(e.target.value) || 0 })} />
        </Field>
      ) : null}
      <Field id={fid("fb")} label="Fallback template (outside the 24-hour window)" hint="WhatsApp only allows approved templates if the customer hasn't written in 24 hours. {{1}} is filled with the first name.">
        <Select value={d.fallbackTemplateId} onChange={(e) => set({ fallbackTemplateId: e.target.value })}>
          <option value="">None — skip if the window is closed (step fails)</option>
          {lists.templates
            .filter((t) => t.slots.every((s) => s.part === "body" && s.index === 1))
            .map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>
            ))}
        </Select>
      </Field>
      <OnErrorField value={d.onError} onChange={(v) => set({ onError: v })} id={fid("err")} />
    </>
  );
}

function TemplateForm({ d, set, lists, fid }: FormProps<NodeDataMap["template"]> & { lists: Lists }) {
  const t = lists.templates.find((x) => x.id === d.templateId);
  const setVar = (key: string, v: VariableMap[string]) => set({ variables: { ...d.variables, [key]: v } });
  return (
    <>
      <Field id={fid("tpl")} label="Approved template" hint={lists.templates.length ? "Marketing templates are only sent to contacts with a recorded opt-in." : "No approved templates yet — create one in Templates."}>
        <Select value={d.templateId} onChange={(e) => set({ templateId: e.target.value, variables: {} })}>
          <option value="">Choose…</option>
          {lists.templates.map((x) => (
            <option key={x.id} value={x.id}>{x.name} ({x.language}, {x.category.toLowerCase()})</option>
          ))}
        </Select>
      </Field>
      {t?.slots.map((s) => {
        const m = d.variables[s.key];
        const media = s.part === "header" && s.kind === "media";
        return (
          <div key={s.key} className="space-y-2 rounded-lg border border-app-border p-2.5">
            <p className="text-caption font-medium text-app-text">{s.label}</p>
            <Select
              aria-label={`${s.label} source`}
              value={!m ? "" : m.source === "static" ? "static" : m.field}
              onChange={(e) => setVar(s.key, e.target.value === "static" ? { source: "static", value: "" } : { source: "field", field: e.target.value as "name", key: "", fallback: "" })}
            >
              <option value="" disabled>Value from…</option>
              {!media ? (
                <>
                  <option value="first_name">Contact first name</option>
                  <option value="name">Contact name</option>
                  <option value="phone">Contact phone</option>
                  <option value="email">Contact email</option>
                  <option value="custom">Custom field</option>
                </>
              ) : null}
              <option value="static">{media ? "Media link" : "Fixed text"}</option>
            </Select>
            {m?.source === "static" ? <Input aria-label={`${s.label} value`} value={m.value} onChange={(e) => setVar(s.key, { source: "static", value: e.target.value })} /> : null}
            {m?.source === "field" && m.field === "custom" ? <Input aria-label={`${s.label} custom field`} placeholder="Field name" value={m.key} onChange={(e) => setVar(s.key, { ...m, key: e.target.value })} /> : null}
            {m?.source === "field" ? <Input aria-label={`${s.label} fallback`} placeholder="Fallback if empty" value={m.fallback} onChange={(e) => setVar(s.key, { ...m, fallback: e.target.value })} /> : null}
          </div>
        );
      })}
      <OnErrorField value={d.onError} onChange={(v) => set({ onError: v })} id={fid("err")} />
    </>
  );
}

function DelayForm({ d, set, fid }: FormProps<NodeDataMap["delay"]>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field id={fid("amt")} label="Wait">
        <Input type="number" min={1} value={d.amount} onChange={(e) => set({ amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      </Field>
      <Field id={fid("unit")} label="Unit">
        <Select value={d.unit} onChange={(e) => set({ unit: e.target.value })}>
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
        </Select>
      </Field>
      <p className="col-span-2 text-caption text-app-subtle">Up to 30 days. Test runs can skip delays.</p>
    </div>
  );
}

function ConditionForm({ d, set, lists, fid }: FormProps<NodeDataMap["condition"]> & { lists: Lists }) {
  const setRule = (i: number, patch: Partial<NodeDataMap["condition"]["rules"][number]>) => set({ rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <>
      <Field id={fid("match")} label="Go down “Yes” when">
        <Select value={d.match} onChange={(e) => set({ match: e.target.value })}>
          <option value="any">Any rule matches</option>
          <option value="all">All rules match</option>
        </Select>
      </Field>
      <ul className="space-y-3">
        {d.rules.map((r, i) => {
          const ops = OPERATORS_FOR[r.field];
          const noValue = r.operator === "is_empty" || r.operator === "is_not_empty";
          const options = r.field === "lead_status" ? LEAD_STATUS_VALUES : r.field === "source" ? SOURCE_VALUES : r.field === "consent" ? CONSENT_VALUES : null;
          return (
            <li key={i} className="space-y-2 rounded-lg border border-app-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-caption font-medium text-app-muted">Rule {i + 1}</span>
                {d.rules.length > 1 ? (
                  <IconButton label={`Remove rule ${i + 1}`} onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })}>
                    <X aria-hidden="true" />
                  </IconButton>
                ) : null}
              </div>
              <Select aria-label="Field" value={r.field} onChange={(e) => { const f = e.target.value as ConditionField; setRule(i, { field: f, operator: OPERATORS_FOR[f][0], value: "" }); }}>
                {CONDITION_FIELDS.map((f) => (
                  <option key={f} value={f}>{CONDITION_FIELD_LABELS[f]}</option>
                ))}
              </Select>
              {r.field === "custom" ? <Input aria-label="Custom field name" placeholder="Field name, e.g. city" value={r.key} onChange={(e) => setRule(i, { key: e.target.value })} /> : null}
              <Select aria-label="Operator" value={r.operator} onChange={(e) => setRule(i, { operator: e.target.value as typeof r.operator })}>
                {ops.map((o) => (
                  <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>
                ))}
              </Select>
              {noValue ? null : options ? (
                <Select aria-label="Value" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} className="capitalize">
                  <option value="">Choose…</option>
                  {options.map((o) => (
                    <option key={o} value={o}>{o.replace("_", " ")}</option>
                  ))}
                </Select>
              ) : r.field === "tag" ? (
                <>
                  <Input aria-label="Tag" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} list={`${fid("rt")}-${i}-list`} />
                  <datalist id={`${fid("rt")}-${i}-list`}>
                    {lists.tags.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </>
              ) : r.field === "date" ? (
                <Input aria-label="Date" type="date" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
              ) : r.field === "time" ? (
                <Input aria-label="Time" type="time" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
              ) : (
                <Input aria-label="Value" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} placeholder={r.operator === "contains" ? "website, price (any of)" : ""} />
              )}
            </li>
          );
        })}
      </ul>
      {d.rules.length < 20 ? (
        <Button size="sm" variant="secondary" onClick={() => set({ rules: [...d.rules, { field: "message", key: "", operator: "contains", value: "" }] })}>
          <Plus aria-hidden="true" /> Add rule
        </Button>
      ) : null}
      <p className="text-caption text-app-subtle">“Customer&apos;s message” is the reply to the last waiting message, or the message that started the automation. Text checks ignore upper/lower case.</p>
    </>
  );
}

function UpdateForm({ d, set, fid }: FormProps<NodeDataMap["update_contact"]>) {
  return (
    <>
      <Field id={fid("field")} label="Field">
        <Select value={d.field} onChange={(e) => set({ field: e.target.value, value: e.target.value === "leadStatus" ? "contacted" : e.target.value === "lifecycle" ? "customer" : "" })}>
          <option value="leadStatus">Lead status</option>
          <option value="lifecycle">Type (lead / customer)</option>
          <option value="name">Name</option>
          <option value="email">Email</option>
          <option value="custom">Custom field</option>
        </Select>
      </Field>
      {d.field === "custom" ? (
        <Field id={fid("key")} label="Custom field name">
          <Input value={d.key} onChange={(e) => set({ key: e.target.value })} placeholder="requirement" maxLength={40} />
        </Field>
      ) : null}
      {d.field === "leadStatus" ? (
        <Field id={fid("val")} label="New value">
          <Select value={d.value} onChange={(e) => set({ value: e.target.value })} className="capitalize">
            {LEAD_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
      ) : d.field === "lifecycle" ? (
        <Field id={fid("val")} label="New value">
          <Select value={d.value} onChange={(e) => set({ value: e.target.value })}>
            <option value="lead">Lead</option>
            <option value="customer">Customer</option>
          </Select>
        </Field>
      ) : (
        <Field id={fid("val")} label="New value" hint="Use {{reply}} to save the customer's answer.">
          <Input value={d.value} onChange={(e) => set({ value: e.target.value })} maxLength={500} />
        </Field>
      )}
    </>
  );
}

/** Webhook-trigger panel: URL + secret (shown once). */
export function WebhookTriggerInfo({ orgId, automationId, hasSecret, canManage }: { orgId: string; automationId: string; hasSecret: boolean; canManage: boolean }) {
  const toast = useToast();
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const url = typeof window === "undefined" ? `/api/automations/hooks/${automationId}` : `${window.location.origin}/api/automations/hooks/${automationId}`;
  async function rotate() {
    setBusy(true);
    const r = await apiFetch<{ secret: string }>(`/api/organizations/${orgId}/automations/${automationId}/webhook-secret`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setSecret(r.data.secret);
  }
  return (
    <div className="space-y-2 rounded-lg border border-app-border p-3 text-small">
      <p className="font-medium text-app-text">Inbound webhook</p>
      <p className="break-all font-mono text-caption text-app-muted">POST {url}</p>
      <p className="text-caption text-app-subtle">Header <code>Authorization: Bearer &lt;secret&gt;</code>, JSON body <code>{"{ phone, name?, email?, data? }"}</code>. Works once the automation is published and active.</p>
      {secret ? (
        <Alert tone="warning" title="Copy this secret now — it won't be shown again">
          <span className="flex items-center gap-2">
            <code className="break-all text-caption">{secret}</code>
            <IconButton label="Copy secret" onClick={() => void navigator.clipboard?.writeText(secret).then(() => toast("Copied"))}>
              <Copy aria-hidden="true" />
            </IconButton>
          </span>
        </Alert>
      ) : (
        <p className="text-caption text-app-muted">{hasSecret ? "A secret is set (stored hashed)." : "No secret yet."}</p>
      )}
      {canManage ? (
        <Button size="sm" variant="secondary" onClick={rotate} loading={busy}>
          <KeyRound aria-hidden="true" /> {hasSecret ? "Generate new secret" : "Generate secret"}
        </Button>
      ) : null}
    </div>
  );
}
