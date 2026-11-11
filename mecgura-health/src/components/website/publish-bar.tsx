"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye } from "lucide-react";
import { Alert, Button, ButtonLink, ConfirmDialog, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function PublishBar({ status, hasChanges, canPublish }: { status: "DRAFT" | "PUBLISHED"; hasChanges: boolean; canPublish: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  async function run(action: "publish" | "unpublish") {
    setBusy(true);
    const res = await apiFetch("/api/website/publish", { method: "POST", body: JSON.stringify({ action }) });
    setBusy(false); setConfirm(null);
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't update the website", description: res.error.message });
    toast({ tone: "success", title: action === "publish" ? "Website published" : "Website taken offline" }); router.refresh();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={status === "PUBLISHED" ? "success" : "warning"}>{status === "PUBLISHED" ? "Published" : "Draft — not public"}</StatusBadge>
        {status === "PUBLISHED" && hasChanges && <StatusBadge tone="info">Unpublished changes</StatusBadge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/preview" target="_blank" variant="outline"><Eye aria-hidden className="size-4" />Preview website</ButtonLink>
        <ButtonLink href="/website/pages" variant="outline">Edit website</ButtonLink>
        {canPublish && (status === "DRAFT" || hasChanges) && <Button onClick={() => setConfirm("publish")}>{status === "DRAFT" ? "Publish website" : "Publish changes"}</Button>}
        {canPublish && status === "PUBLISHED" && <Button variant="outline" onClick={() => setConfirm("unpublish")}>Unpublish</Button>}
      </div>
      {!canPublish && <Alert tone="info">Only a Clinic Admin can publish or unpublish the website.</Alert>}
      <ConfirmDialog open={confirm === "publish"} onCancel={() => setConfirm(null)} onConfirm={() => run("publish")} loading={busy} tone="primary" title="Publish the website?" description="Your saved draft content becomes visible to everyone on your website address. Services, doctors, testimonials, FAQs and articles are published separately." confirmLabel="Publish" />
      <ConfirmDialog open={confirm === "unpublish"} onCancel={() => setConfirm(null)} onConfirm={() => run("unpublish")} loading={busy} title="Take the website offline?" description="Visitors will see a “coming soon” page. Your content is kept and you can publish again any time." confirmLabel="Unpublish" />
    </div>
  );
}
