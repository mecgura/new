"use client";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function EnquiryActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  if (!canManage) return null;
  async function set(s: string) {
    const res = await apiFetch(`/api/website/enquiries/${id}`, { method: "PATCH", body: JSON.stringify({ status: s }) });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't update", description: res.error.message });
    router.refresh();
  }
  return (
    <span className="flex flex-wrap justify-end gap-2">
      {status === "NEW" && <Button size="sm" variant="outline" onClick={() => void set("READ")}>Mark read</Button>}
      {status !== "ARCHIVED" ? <Button size="sm" variant="ghost" onClick={() => void set("ARCHIVED")}>Archive</Button> : <Button size="sm" variant="outline" onClick={() => void set("NEW")}>Restore</Button>}
    </span>
  );
}
