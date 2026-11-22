import { PublishError } from "@/lib/onepost-publish";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import { http } from "@/providers/onepost/http";

/** Normalises what a person types ("myblog.com/" or "https://myblog.com/blog") to the site's https origin plus path, with no trailing slash. */
export function normaliseSite(input: string): string {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });

async function safe(site: string) {
  try {
    await assertPublicHttpsUrl(site);
  } catch (e) {
    throw new PublishError(e instanceof UnsafeUrlError ? e.message : "That site address can't be used.", false);
  }
}

/** Checks the site, username and Application Password together (the WordPress-supported way for apps to publish). */
export async function wpVerify(site: string, user: string, appPassword: string) {
  await safe(site);
  const me = await http<{ id?: number; name?: string }>(`${site}/wp-json/wp/v2/users/me?context=edit`, { label: "WordPress", headers: basic(user, appPassword) });
  if (!me.json.id) throw new PublishError("WordPress did not accept those login details.", false);
  const info = await http<{ name?: string }>(`${site}/wp-json/`, { label: "WordPress" }).catch(() => null);
  return { siteName: info?.json.name || site.replace(/^https:\/\//, ""), userName: me.json.name ?? user };
}

export type WpPost = { title: string; slug: string; html: string; excerpt: string; status: "publish" | "draft"; image?: { bytes: Uint8Array; contentType: string; filename: string } };

/** Uploads the featured image (if any) and creates the post. Returns the post id and its link. */
export async function wpPublish(site: string, user: string, appPassword: string, p: WpPost) {
  await safe(site);
  const auth = basic(user, appPassword);
  let mediaId = 0;
  if (p.image) {
    const m = await http<{ id?: number }>(`${site}/wp-json/wp/v2/media`, {
      label: "WordPress",
      method: "POST",
      headers: { ...auth, "content-type": p.image.contentType, "content-disposition": `attachment; filename="${p.image.filename.replace(/[^\w.-]/g, "_")}"` },
      body: p.image.bytes as BodyInit,
      timeoutMs: 60_000,
    });
    mediaId = m.json.id ?? 0;
  }
  const r = await http<{ id?: number; link?: string }>(`${site}/wp-json/wp/v2/posts`, {
    label: "WordPress",
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ title: p.title, slug: p.slug, content: p.html, excerpt: p.excerpt, status: p.status, ...(mediaId ? { featured_media: mediaId } : {}) }),
  });
  return { id: String(r.json.id ?? ""), url: r.json.link ?? "" };
}
