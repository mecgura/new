import type { Metadata } from "next";
import QRCode from "qrcode";
import { getInboxContext } from "@/lib/inbox-context";
import { roleHasPermission } from "@/lib/authz";
import { NoWorkspace } from "@/components/whatsapp/states";
import { ServiceLocked } from "@/components/whatsapp/service-locked";
import { isServiceEnabled } from "@/services/whatsapp/guards";
import { listSpots } from "@/services/food/food";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/food/print-button";

export const metadata: Metadata = { title: "Menu QR codes" };

/** Print-ready sheet: one QR card per active room/table. */
export default async function FoodQrPage() {
  const ctx = await getInboxContext();
  if (!ctx.active) return <NoWorkspace />;
  if (!(await isServiceEnabled(ctx.orgId, "FOOD_ORDERING"))) return <ServiceLocked name="Food ordering" />;
  if (!roleHasPermission(ctx.me.role, "food:manage")) return <ServiceLocked name="Food ordering (managers only)" />;
  const [spots, s] = await Promise.all([listSpots(ctx.orgId), db.foodSettings.findUnique({ where: { organizationId: ctx.orgId }, select: { venueName: true } })]);
  const cards = await Promise.all(spots.filter((x) => x.active).map(async (x) => ({ ...x, qr: await QRCode.toDataURL(x.url, { width: 360, margin: 1, errorCorrectionLevel: "M" }) })));
  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-small text-app-muted">{cards.length} QR code(s). Print on A4, cut and place one on each room/table.</p>
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-3">
        {cards.map((c) => (
          <div key={c.id} className="break-inside-avoid rounded-2xl border border-black/10 bg-white p-4 text-center text-black">
            <p className="text-sm font-semibold">{s?.venueName || "Order food"}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.qr} alt={`QR code for ${c.label}`} className="mx-auto my-2 w-full max-w-[180px]" />
            <p className="text-lg font-bold">{c.label}</p>
            <p className="text-xs text-black/60">Scan → choose → confirm on WhatsApp</p>
          </div>
        ))}
      </div>
    </div>
  );
}
