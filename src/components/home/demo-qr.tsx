import QRCode from "qrcode";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

/** "Scan and see it live": a QR code that opens a WhatsApp chat with MECGURA. Drawn on the server as inline SVG. */
export async function DemoQr({ whatsapp }: { whatsapp: string }) {
  const link = `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hi MECGURA, I scanned your QR code. Show me how WhatsApp automation works.")}`;
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#075e54", light: "#ffffff" } });
  return (
    <section aria-labelledby="demo-qr-title" className="mx-auto max-w-6xl px-4 py-14">
      <div data-reveal className="wa-card grid items-center gap-8 p-8 sm:grid-cols-[auto_1fr] sm:p-10">
        {/* Inline SVG generated from our own link by the qrcode library (no user input). */}
        <div role="img" aria-label="QR code that opens a WhatsApp chat with MECGURA" className="mx-auto size-44 shrink-0 overflow-hidden rounded-xl border border-[var(--wa-line)] bg-white p-1 sm:size-52 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="text-center sm:text-left">
          <h2 id="demo-qr-title" className="font-display text-3xl font-bold sm:text-4xl">See it on your own phone</h2>
          <p className="wa-muted mt-3 max-w-xl">Point your phone camera at this code. It opens a WhatsApp chat with us, so you can feel what your customers will feel: a quick reply, clear options and a real person when needed.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start">
            <a href={link} data-track="demo_qr_whatsapp" className="wa-btn"><MessageCircle className="size-5" aria-hidden="true" /> On your phone? Tap here</a>
            <Link href="/tools" data-track="demo_qr_tools" className="wa-btn wa-btn-ghost">Free WhatsApp tools</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
