import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listAnnouncements, saveAnnouncement } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => ({ announcements: await listAnnouncements(ctx) }));
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => saveAnnouncement(ctx, await readJson(req)));
