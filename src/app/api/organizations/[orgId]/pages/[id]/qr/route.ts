import QRCode from "qrcode";
import { handle } from "@/lib/api";
import { pagesRoute } from "@/services/landing/route-guard";
import { getPage } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** PNG QR code of the page link (with utm_source=qr so scans show up in the page's sources). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:read");
  const page = await getPage(ctx.organizationId, ids.id);
  const png = await QRCode.toBuffer(`${page.url}?utm_source=qr`, { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M" });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "content-disposition": `attachment; filename="${page.slug}-qr.png"`, "cache-control": "private, no-store" } });
});
