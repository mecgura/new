import QRCode from "qrcode";
import { ApiError, handle } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listSpots } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** PNG QR code that opens this room's/table's menu. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:manage");
  const spot = (await listSpots(access.organizationId)).find((s) => s.id === ids.id);
  if (!spot) throw new ApiError("NOT_FOUND", "Room/table not found.");
  const png = await QRCode.toBuffer(spot.url, { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M" });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "content-disposition": `attachment; filename="menu-qr-${spot.code}.png"`, "cache-control": "private, no-store" } });
});
