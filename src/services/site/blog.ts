import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/markdown";

/** Public blog: published posts for the site, drafts only for Super Admin. */
export const blogPostSchema = z.object({
  title: z.string().trim().min(5, "Write a title").max(120),
  slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/, "Lowercase letters, numbers and dashes").default(""),
  excerpt: z.string().trim().max(160, "Keep it under 160 characters — Google shows about that much").default(""),
  body: z.string().max(60_000).default(""),
  tags: z.string().trim().max(200).default(""),
  author: z.string().trim().min(1).max(60).default("MECGURA Team"),
  coverUrl: z.string().trim().max(500).refine((v) => !v || /^https:\/\/\S+$/.test(v) || /^\/\S+$/.test(v), "Use an https:// or /path image link").default(""),
  status: z.enum(["draft", "published"]).default("draft"),
});
export type BlogPostInput = z.infer<typeof blogPostSchema>;

export const tagList = (tags: string) => tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);

export async function listPublished(limit = 50) {
  try {
    return await db.blogPost.findMany({ where: { status: "published", publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: limit, select: { id: true, slug: true, title: true, excerpt: true, tags: true, author: true, coverUrl: true, publishedAt: true, updatedAt: true, body: true } });
  } catch {
    return [];
  }
}

export async function getPublished(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return db.blogPost.findFirst({ where: { slug, status: "published", publishedAt: { lte: new Date() } } });
}

/** Counts a view without blocking the page (best effort). */
export async function countView(id: string) {
  await db.blogPost.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => null);
}

export async function adminList() {
  return db.blogPost.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], select: { id: true, slug: true, title: true, excerpt: true, status: true, publishedAt: true, updatedAt: true, views: true, tags: true } });
}

export async function adminGet(id: string) {
  const p = await db.blogPost.findUnique({ where: { id } });
  if (!p) throw new ApiError("NOT_FOUND", "Post not found.");
  return p;
}

async function uniqueSlug(base: string, exceptId?: string) {
  const root = slugify(base) || "post";
  for (let i = 1; ; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const clash = await db.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (!clash || clash.id === exceptId) return slug;
  }
}

function checkPublish(input: BlogPostInput) {
  if (input.status !== "published") return;
  if (input.body.trim().split(/\s+/).length < 150) throw new ApiError("VALIDATION_ERROR", "Write at least 150 words before publishing — short pages rarely rank.", { details: { body: ["Too short to publish"] } });
  if (!input.excerpt) throw new ApiError("VALIDATION_ERROR", "Add a short description (shown on Google) before publishing.", { details: { excerpt: ["Required to publish"] } });
}

export async function createPost(adminId: string, input: BlogPostInput, req?: Request) {
  checkPublish(input);
  const slug = await uniqueSlug(input.slug || input.title);
  const p = await db.blogPost.create({ data: { ...input, slug, publishedAt: input.status === "published" ? new Date() : null } });
  await audit({ action: "blog.saved", actorUserId: adminId, targetType: "blog_post", targetId: p.id, metadata: { slug, status: p.status }, req });
  return p;
}

export async function updatePost(adminId: string, id: string, input: BlogPostInput, req?: Request) {
  const before = await adminGet(id);
  checkPublish(input);
  const slug = input.slug && input.slug !== before.slug ? await uniqueSlug(input.slug, id) : before.slug;
  const p = await db.blogPost.update({
    where: { id },
    data: { ...input, slug, publishedAt: input.status === "published" ? (before.publishedAt ?? new Date()) : null },
  });
  await audit({ action: "blog.saved", actorUserId: adminId, targetType: "blog_post", targetId: id, metadata: { slug, status: p.status }, req });
  return p;
}

export async function deletePost(adminId: string, id: string, req?: Request) {
  await adminGet(id);
  await db.blogPost.delete({ where: { id } });
  await audit({ action: "blog.deleted", actorUserId: adminId, targetType: "blog_post", targetId: id, req });
}
