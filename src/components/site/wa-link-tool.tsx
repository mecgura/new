"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink } from "lucide-react";
import { waDigits, waLink } from "@/lib/wa-link";

const field = "mt-1.5 w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/20";

/** Free WhatsApp link + QR code maker. Everything happens in the browser: the number and message are never sent anywhere. */
export function WaLinkTool({ mode, whatsapp }: { mode: "link" | "qr"; whatsapp: string }) {
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("Hi, I saw your page and want to know more.");
  const [dark, setDark] = React.useState("#075e54");
  const [qr, setQr] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const digits = waDigits(phone);
  const link = digits ? waLink(digits, message) : "";

  React.useEffect(() => {
    let live = true;
    if (!link) {
      const t = window.setTimeout(() => live && setQr(""), 0);
      return () => window.clearTimeout(t);
    }
    void QRCode.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: "M", color: { dark, light: "#ffffff" } }).then((u) => live && setQr(u));
    return () => {
      live = false;
    };
  }, [link, dark]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the link is still selectable */
    }
  }

  return (
    <div className="wa-card grid gap-6 p-6 md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label htmlFor="t-phone" className="text-small font-semibold">WhatsApp number</label>
          <input id="t-phone" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210 or +91 98765 43210" className={field} aria-invalid={Boolean(phone) && !digits} />
          <p className="wa-muted mt-1 text-caption">{phone && !digits ? "Enter the full number with country code (10-digit Indian numbers get +91 automatically)." : "Indian 10-digit numbers get +91 automatically."}</p>
        </div>
        <div>
          <label htmlFor="t-msg" className="text-small font-semibold">Message customers send first <span className="wa-muted font-normal">(optional)</span></label>
          <textarea id="t-msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} className={field} />
        </div>
        {mode === "qr" ? (
          <div>
            <label htmlFor="t-color" className="text-small font-semibold">QR colour</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[["#075e54", "Green"], ["#000000", "Black"], ["#1d4ed8", "Blue"], ["#7c2d12", "Brown"]].map(([c, n]) => (
                <button key={c} type="button" onClick={() => setDark(c)} aria-pressed={dark === c} aria-label={n} className={`size-9 rounded-full border-2 ${dark === c ? "border-[#128c7e] ring-2 ring-[#128c7e]/30" : "border-[var(--wa-line)]"}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        ) : null}
        <p className="wa-muted text-caption">Private by design: this tool runs in your browser. We never see your number.</p>
      </div>
      <div className="space-y-4" aria-live="polite">
        {!link ? (
          <p className="wa-muted grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--wa-line)] p-6 text-center text-small">Enter your number to get the link and QR code.</p>
        ) : (
          <>
            <div>
              <p className="text-small font-semibold">Your WhatsApp link</p>
              <p className="mt-1.5 break-all rounded-lg bg-[#f4f7f6] p-3 text-small" data-testid="wa-link">{link}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className="wa-btn !min-h-10 text-small"><Copy className="size-4" aria-hidden="true" /> {copied ? "Copied ✓" : "Copy link"}</button>
                <a href={link} target="_blank" rel="noopener noreferrer" className="wa-btn wa-btn-ghost !min-h-10 text-small"><ExternalLink className="size-4" aria-hidden="true" /> Test it</a>
              </div>
            </div>
            {qr ? (
              <div>
                <p className="text-small font-semibold">QR code</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR code that opens your WhatsApp chat" className="mt-1.5 size-48 rounded-lg border border-[var(--wa-line)]" />
                <a href={qr} download="whatsapp-qr.png" data-track={mode === "qr" ? "tool_qr_download" : "tool_link_qr"} className="wa-btn wa-btn-ghost mt-2 !min-h-10 text-small"><Download className="size-4" aria-hidden="true" /> Download PNG</a>
              </div>
            ) : null}
          </>
        )}
      </div>
      <p className="wa-muted text-caption md:col-span-2">
        Want customers who tap this link to get an instant reply, price list and brochure automatically?{" "}
        <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Hi MECGURA, I made a WhatsApp link and want automatic replies on it.")}`} data-track="tool_cta" className="font-semibold text-[#128c7e] hover:underline">Talk to MECGURA →</a>
      </p>
    </div>
  );
}
