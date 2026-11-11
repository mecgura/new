"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Avatar, Button, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Profile photo (PNG/JPG/WebP ≤ 512 KB). Validated by file content on the server. */
export function AvatarUploader({ userId, name, url }: { userId: string; name: string; url: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    const res = await apiFetch(`/api/users/${userId}/avatar`, { method: "POST", body });
    if (input.current) input.current.value = "";
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't upload photo", description: res.error.fieldErrors?.file ?? res.error.message });
    toast({ tone: "success", title: "Photo updated" }); router.refresh();
  }
  async function remove() {
    const res = await apiFetch(`/api/users/${userId}/avatar`, { method: "DELETE" });
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't remove photo", description: res.error.message });
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} src={url} size="lg" />
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="avatar-file" aria-label="Choose profile photo" onChange={(e) => void upload(e.target.files?.[0])} />
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>Change photo</Button>
        {url && <Button size="sm" variant="ghost" onClick={remove}>Remove</Button>}
      </div>
    </div>
  );
}
