import { ApiError, errorResponse, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactListSchema } from "@/lib/validations";
import { exportContactsCsv } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { access } = await orgRoute(req, params, "contacts:export");
    const q = readQuery(req, contactListSchema);
    const { csv } = await exportContactsCsv(
      { organizationId: access.organizationId, actorUserId: access.user.id, req },
      { tab: q.tab, q: q.q, tagId: q.tagId || undefined, leadStatus: q.leadStatus || undefined, ownerUserId: q.ownerUserId || undefined }
    );
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${q.tab}-${date}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    console.error("[contacts:export]", e);
    return errorResponse(new ApiError("SERVER_ERROR"));
  }
}
