"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Card, DataTable, Modal, StatusBadge, useToast, type Column } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { FieldsForm, type FieldDef, type Values } from "./fields";

export interface ManagerRow { id: string; title: string; subtitle?: string; status: string; updated: string; values: Values }
type Props = { resource: string; noun: string; fields: FieldDef[]; blank: Values; rows: ManagerRow[]; canCreate: boolean; canEdit: boolean; canPublish: boolean; emptyHint: string; publishNote?: string };

const TONE: Record<string, "success" | "warning" | "neutral"> = { PUBLISHED: "success", DRAFT: "warning", ARCHIVED: "neutral" };

/** Generic list + create/edit modal for services, testimonials, FAQ and articles. */
export function ResourceManager({ resource, noun, fields, blank, rows, canCreate, canEdit, canPublish, emptyHint, publishNote }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id?: string; values: Values } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const res = await apiFetch<{ revertedToDraft?: boolean }>(editing.id ? `/api/website/${resource}/${editing.id}` : `/api/website/${resource}`, { method: editing.id ? "PATCH" : "POST", body: JSON.stringify(editing.values) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); return toast({ tone: "danger", title: "Couldn't save", description: res.error.message }); }
    toast({ tone: "success", title: editing.id ? `${noun} saved` : `${noun} created as a draft`, description: res.data.revertedToDraft ? "It was taken back to draft — an admin must publish it again." : undefined });
    setEditing(null); setErrors({}); router.refresh();
  }
  async function setStatus(id: string, status: string) {
    const res = await apiFetch(`/api/website/${resource}/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't change status", description: res.error.message });
    toast({ tone: "success", title: status === "PUBLISHED" ? "Published — now visible on the website" : status === "DRAFT" ? "Moved to draft — no longer visible" : "Archived" });
    router.refresh();
  }

  const columns: Column<ManagerRow>[] = [
    { key: "title", header: noun, cell: (r) => <span className="text-left"><span className="font-semibold">{r.title}</span>{r.subtitle && <span className="type-caption block">{r.subtitle}</span>}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={TONE[r.status] ?? "neutral"}>{r.status[0] + r.status.slice(1).toLowerCase()}</StatusBadge> },
    { key: "updated", header: "Updated", cell: (r) => r.updated, hideOnMobile: true },
    { key: "actions", header: "Actions", align: "right", cell: (r) => (
      <span className="flex flex-wrap justify-end gap-2">
        {canEdit && <Button size="sm" variant="outline" onClick={() => { setErrors({}); setEditing({ id: r.id, values: r.values }); }}>Edit</Button>}
        {canPublish && r.status !== "PUBLISHED" && r.status !== "ARCHIVED" && <Button size="sm" onClick={() => void setStatus(r.id, "PUBLISHED")}>Publish</Button>}
        {canEdit && r.status === "PUBLISHED" && <Button size="sm" variant="outline" onClick={() => void setStatus(r.id, "DRAFT")}>Unpublish</Button>}
        {canEdit && r.status !== "ARCHIVED" && <Button size="sm" variant="ghost" onClick={() => void setStatus(r.id, "ARCHIVED")}>Archive</Button>}
        {canEdit && r.status === "ARCHIVED" && <Button size="sm" variant="outline" onClick={() => void setStatus(r.id, "DRAFT")}>Restore</Button>}
      </span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-secondary">{rows.length} {noun.toLowerCase()}{rows.length === 1 ? "" : "s"}</p>
        {canCreate && <Button onClick={() => { setErrors({}); setEditing({ values: blank }); }}><Plus aria-hidden className="size-4" />Add {noun.toLowerCase()}</Button>}
      </div>
      {publishNote && <Alert tone="info">{publishNote}</Alert>}
      <Card className="overflow-hidden"><DataTable caption={`${noun} list`} columns={columns} rows={rows} rowKey={(r) => r.id} empty={{ title: `No ${noun.toLowerCase()}s yet`, description: emptyHint }} /></Card>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`} description={editing.id ? undefined : "Saved as a draft. Nothing appears on the website until it is published."}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy}>{editing.id ? "Save changes" : "Save draft"}</Button></>}>
          {Object.keys(errors).length > 0 && <Alert tone="danger" className="mb-4" title="Please fix the highlighted fields" />}
          <FieldsForm fields={fields} value={editing.values} onChange={(values) => setEditing({ ...editing, values })} errors={errors} />
        </Modal>
      )}
    </div>
  );
}
