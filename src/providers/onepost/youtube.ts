import { PublishError } from "@/lib/onepost-publish";
import { bearer, http } from "@/providers/onepost/http";

/** The signed-in person's YouTube channel (id and title). */
export async function youtubeChannel(token: string) {
  const r = await http<{ items?: { id?: string; snippet?: { title?: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { label: "YouTube", headers: bearer(token) });
  const c = r.json.items?.[0];
  if (!c?.id) throw new PublishError("This Google account has no YouTube channel. Create one on YouTube first, then connect again.", false);
  return { id: c.id, name: c.snippet?.title ?? "YouTube channel" };
}

export type YoutubeVideo = { title: string; description: string; tags: string[]; privacy: "public" | "unlisted" | "private"; videoUrl: string; size: number; contentType: string };

/**
 * Uploads a video with YouTube's resumable upload. The file is streamed from storage into YouTube (never held in memory),
 * so a large video only needs the time it takes to transfer. Returns the video id and its watch link.
 */
export async function youtubeUpload(token: string, v: YoutubeVideo) {
  const init = await http("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    label: "YouTube",
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(v.size), "x-upload-content-type": v.contentType },
    body: JSON.stringify({
      snippet: { title: v.title.slice(0, 100), description: v.description.slice(0, 5000), tags: v.tags, categoryId: "22" },
      status: { privacyStatus: v.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new PublishError("YouTube did not give an upload address.", true);
  let src: Response;
  try {
    src = await fetch(v.videoUrl, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new PublishError("The stored video could not be read.", true);
  }
  if (!src.ok || !src.body) throw new PublishError(`The stored video could not be read (${src.status}).`, true);
  const done = await http<{ id?: string }>(uploadUrl, {
    label: "YouTube",
    method: "PUT",
    headers: { "content-type": v.contentType, "content-length": String(v.size) },
    body: src.body as unknown as BodyInit,
    // Node needs this to send a streamed request body.
    ...({ duplex: "half" } as object),
    timeoutMs: 55_000,
  });
  const id = done.json.id;
  if (!id) throw new PublishError("YouTube did not confirm the upload.", true);
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

/** Sets the cover image. YouTube allows this only for verified channels, so a refusal never fails the post. */
export async function youtubeSetThumbnail(token: string, videoId: string, image: { bytes: Uint8Array; contentType: string }) {
  try {
    await http(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { label: "YouTube", method: "POST", headers: { ...bearer(token), "content-type": image.contentType }, body: image.bytes as BodyInit });
    return true;
  } catch {
    return false;
  }
}
