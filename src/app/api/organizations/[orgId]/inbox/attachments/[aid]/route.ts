import { NextResponse } from "next/server";
import { errorResponse, ApiError } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { openAttachment } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/(aac|mp4|mpeg|amr|ogg)|application\/pdf)$/;

/** Authenticated media proxy: streams from Meta; dangerous types are always downloaded, never rendered. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { access, ids } = await orgRoute(req, params, "inbox:read");
    const media = await openAttachment(access, ids.aid);
    const safeName = media.filename.replace(/[^\w.\- ]/g, "_");
    const inline = INLINE.test(media.mimeType);
    return new NextResponse(media.body, {
      headers: {
        "Content-Type": inline ? media.mimeType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    throw e;
  }
}
