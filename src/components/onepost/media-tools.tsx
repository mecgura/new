"use client";

import * as React from "react";
import { upload } from "@vercel/blob/client";
import { Crop, Film } from "lucide-react";
import { Button, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { RATIOS, RATIO_KEYS, type Ratio } from "@/lib/onepost-media";
import type { PostDetail } from "@/services/onepost/posts";

type Media = PostDetail["media"][number];

/** Resized copies of each photo (square, portrait, story, wide), with the brand logo if wanted, and a cover frame for each video. */
export function MediaTools({ orgId, post, canEdit, hasLogo, onPost }: { orgId: string; post: PostDetail; canEdit: boolean; hasLogo: boolean; onPost: (p: PostDetail) => void }) {
  const base = `/api/organizations/${orgId}/onepost/posts/${post.id}`;
  const toast = useToast();
  const [ratios, setRatios] = React.useState<Set<Ratio>>(new Set(["1:1", "4:5"]));
  const [logo, setLogo] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [cover, setCover] = React.useState<{ media: Media; at: number } | null>(null);
  const originals = post.media.filter((m) => m.kind === "image" && !m.variantOf);
  const videos = post.media.filter((m) => m.kind === "video");
  if (!canEdit || (!originals.length && !videos.length)) return null;

  const toggle = (r: Ratio) => setRatios((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });

  async function resize(m: Media) {
    setBusy(m.id);
    const r = await apiFetch<{ post: PostDetail }>(`${base}/media/${m.id}/variants`, { method: "POST", body: { ratios: [...ratios], watermark: logo } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    onPost(r.data.post);
    toast("Resized copies added", "success");
  }

  async function saveCover() {
    if (!cover) return;
    const video = document.getElementById("op-cover-video") as HTMLVideoElement | null;
    if (!video) return;
    setBusy("cover");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth || 1280, 1280);
      canvas.height = Math.round(canvas.width * ((video.videoHeight || 720) / (video.videoWidth || 1280)));
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
      if (!blob) throw new Error("Could not read that frame.");
      const b = await upload(`onepost/${orgId}/${post.id}/cover-${Date.now()}.jpg`, blob, { access: "public", handleUploadUrl: `${base}/media/blob`, contentType: "image/jpeg" });
      const r = await apiFetch<{ post: PostDetail }>(`${base}/media/${cover.media.id}/thumbnail`, { method: "POST", body: { url: b.url } });
      if (!r.ok) throw new Error(r.error);
      onPost(r.data.post);
      setCover(null);
      toast("Cover saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the cover.", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-3 border-t border-app-border pt-3">
      {originals.length ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-small font-medium text-app-text"><Crop className="size-4" aria-hidden="true" /> Resize for each channel</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Shapes">
            {RATIO_KEYS.map((r) => (
              <label key={r} className={`cursor-pointer rounded-full border px-3 py-1 text-caption ${ratios.has(r) ? "border-app-primary text-app-text" : "border-app-border text-app-muted"}`}>
                <input type="checkbox" className="sr-only" checked={ratios.has(r)} onChange={() => toggle(r)} /> {RATIOS[r].label}
              </label>
            ))}
          </div>
          <p className="text-caption text-app-subtle">{[...ratios].map((r) => RATIOS[r].note).join(" · ") || "Choose at least one shape."}</p>
          {hasLogo ? (
            <label className="flex items-center gap-2 text-small text-app-text"><input type="checkbox" className="size-4 accent-[var(--color-app-primary)]" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> Put my brand logo on the copies</label>
          ) : (
            <p className="text-caption text-app-subtle">Add a logo in the Brand profile to put it on the copies.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {originals.map((m) => (
              <Button key={m.id} size="sm" variant="secondary" disabled={!ratios.size} loading={busy === m.id} onClick={() => void resize(m)}>Resize “{m.name.slice(0, 18)}”</Button>
            ))}
          </div>
        </div>
      ) : null}

      {videos.length ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-small font-medium text-app-text"><Film className="size-4" aria-hidden="true" /> Video cover</p>
          <div className="flex flex-wrap gap-2">
            {videos.map((v) => (
              <Button key={v.id} size="sm" variant="secondary" onClick={() => setCover({ media: v, at: 0 })}>{v.thumbUrl ? "Change cover" : "Pick cover"}: {v.name.slice(0, 18)}</Button>
            ))}
          </div>
          {cover ? (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-app-border p-3">
              {/* The video is loaded from public storage with CORS so one frame can be saved as the cover. */}
              <video id="op-cover-video" src={cover.media.url} crossOrigin="anonymous" preload="auto" muted className="max-h-64 w-full bg-black" onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 0.1; }} />
              <label className="block text-caption text-app-muted">Move to the frame you want
                <input type="range" min={0} max={100} value={cover.at} className="mt-1 w-full" onChange={(e) => {
                  const v = document.getElementById("op-cover-video") as HTMLVideoElement | null;
                  const at = Number(e.target.value);
                  setCover({ ...cover, at });
                  if (v && v.duration) v.currentTime = (v.duration * at) / 100;
                }} />
              </label>
              <div className="flex gap-2">
                <Button size="sm" loading={busy === "cover"} onClick={() => void saveCover()}>Use this frame</Button>
                <Button size="sm" variant="ghost" onClick={() => setCover(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
