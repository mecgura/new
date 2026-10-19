import { beforeAll, describe, expect, it } from "vitest";
import { actAs, json, makeUser, req } from "../helpers";
import * as route from "@/app/api/admin/site-content/route";
import { DEFAULT_HOME_CONTENT, getHomeContent } from "@/services/site/home-content";

let admin: Awaited<ReturnType<typeof makeUser>>;
let owner: Awaited<ReturnType<typeof makeUser>>;
const put = (body: unknown) => route.PUT(req("/api/admin/site-content", { method: "PUT", body }));
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

beforeAll(async () => {
  admin = await makeUser({ role: "SUPER_ADMIN", name: "Site Admin" });
  owner = await makeUser({ name: "Not Admin" });
});

describe("home page content", () => {
  it("falls back to the defaults until the admin saves", async () => {
    expect((await getHomeContent()).services.length).toBe(DEFAULT_HOME_CONTENT.services.length);
  });

  it("only a Super Admin can read or change it", async () => {
    actAs(owner);
    expect((await route.GET(req("/api/admin/site-content"))).status).toBe(403);
    expect((await put(DEFAULT_HOME_CONTENT)).status).toBe(403);
  });

  it("saves team, services and integrations and serves them back", async () => {
    actAs(admin);
    const res = await json(
      await put({
        team: [{ id: "t1", name: "Guri", role: "Founder", bio: "", photo: PHOTO }],
        services: [{ id: "s1", title: "WhatsApp inbox", text: "", state: "live" }],
        integrations: [{ id: "i1", name: "Calendar", note: "", state: "soon" }],
      })
    );
    expect(res.status).toBe(200);
    const saved = await getHomeContent();
    expect(saved.team[0]).toMatchObject({ name: "Guri", role: "Founder", photo: PHOTO });
    expect(saved.integrations[0].state).toBe("soon");
  });

  it("removing everything is allowed (sections then hide)", async () => {
    actAs(admin);
    expect((await put({ team: [], services: [], integrations: [] })).status).toBe(200);
    expect((await getHomeContent()).services).toEqual([]);
  });

  it("rejects blank names, non-image photos and too many members", async () => {
    actAs(admin);
    const member = { id: "x", name: "A", role: "", bio: "", photo: "" };
    expect((await put({ team: [{ ...member, name: " " }], services: [], integrations: [] })).status).toBe(400);
    expect((await put({ team: [{ ...member, photo: "javascript:alert(1)" }], services: [], integrations: [] })).status).toBe(400);
    expect((await put({ team: [{ ...member, photo: "data:image/svg+xml;base64,PHN2Zz4=" }], services: [], integrations: [] })).status).toBe(400);
    expect((await put({ team: Array.from({ length: 13 }, (_, i) => ({ ...member, id: `m${i}` })), services: [], integrations: [] })).status).toBe(400);
  });
});
