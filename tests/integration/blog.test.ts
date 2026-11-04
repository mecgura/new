import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeUser, params, req } from "../helpers";
import * as listRoute from "@/app/api/admin/blog/route";
import * as itemRoute from "@/app/api/admin/blog/[id]/route";
import { renderMarkdown, slugify } from "@/lib/markdown";
import { getPublished } from "@/services/site/blog";
import sitemap from "@/app/sitemap";
import { BLOG_STARTERS } from "../../prisma/blog-starters";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("blog markdown", () => {
  it("escapes raw HTML and only allows safe links", () => {
    const { html, headings } = renderMarkdown(`## Price <b>guide</b>\n\n<script>alert(1)</script> **bold** [ok](https://example.com) [bad](javascript:alert(1)) [home](/pricing)\n\n- a\n- b`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://example.com" rel="noopener nofollow" target="_blank">ok</a>');
    expect(html).toContain('<a href="/pricing">home</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(headings[0]).toMatchObject({ id: "price-b-guide-b", level: 2 });
  });
  it("makes clean slugs", () => {
    expect(slugify("WhatsApp API — Price in India (2026)!")).toBe("whatsapp-api-price-in-india-2026");
  });
  it("starter articles are long enough to publish and render without raw HTML", () => {
    for (const s of BLOG_STARTERS) {
      expect(s.body.trim().split(/\s+/).length).toBeGreaterThanOrEqual(400);
      expect(s.excerpt.length).toBeLessThanOrEqual(160);
      expect(renderMarkdown(s.body).html).not.toMatch(/<script|<img|javascript:/);
    }
  });
});

describe("admin blog", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    admin = await makeUser({ role: "SUPER_ADMIN", name: "Guri" });
  });

  it("only Super Admin can manage posts", async () => {
    actAs(await makeUser({ name: "Client" }));
    expect((await listRoute.GET(req("/x"))).status).toBe(403);
    expect((await listRoute.POST(req("/x", { method: "POST", body: { title: "Hello world" } }))).status).toBe(403);
  });

  it("drafts stay private, publishing needs 150 words and a description, slugs stay unique", async () => {
    actAs(admin);
    const d = await json(await listRoute.POST(req("/x", { method: "POST", body: { title: "WhatsApp tips for shops", body: "short" } })));
    expect(d.status).toBe(201);
    const draft = d.body.post as { id: string; slug: string };
    expect(draft.slug).toBe("whatsapp-tips-for-shops");
    expect(await getPublished(draft.slug)).toBeNull();

    const tooShort = await listRoute.POST(req("/x", { method: "POST", body: { title: "Too short post", body: words(20), excerpt: "x", status: "published" } }));
    expect(tooShort.status).toBe(400);
    const noExcerpt = await listRoute.POST(req("/x", { method: "POST", body: { title: "No description", body: words(200), status: "published" } }));
    expect(noExcerpt.status).toBe(400);

    const pub = await json(await itemRoute.PUT(req("/x", { method: "PUT", body: { title: "WhatsApp tips for shops", slug: draft.slug, body: words(200), excerpt: "Simple tips.", status: "published" } }), params({ id: draft.id })));
    expect(pub.status).toBe(200);
    expect((await getPublished(draft.slug))?.id).toBe(draft.id);
    expect((await sitemap()).some((e) => e.url.endsWith(`/blog/${draft.slug}`))).toBe(true);

    const dup = await json(await listRoute.POST(req("/x", { method: "POST", body: { title: "WhatsApp tips for shops" } })));
    expect((dup.body.post as { slug: string }).slug).toBe("whatsapp-tips-for-shops-2");

    expect((await itemRoute.DELETE(req("/x", { method: "DELETE" }), params({ id: draft.id }))).status).toBe(200);
    expect(await db.blogPost.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { action: "blog.deleted", targetId: draft.id } })).toBe(1);
  });
});
