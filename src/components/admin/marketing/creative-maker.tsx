"use client";

import * as React from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * Ready-to-post images with MECGURA branding, drawn on a canvas in the browser and downloaded as PNG. The proof
 * template uses real platform numbers (no client named), the offer template the next festival from Festivals.
 */
type TemplateId = "photo" | "offer" | "proof" | "tip" | "compare" | "feature";
type SizeId = "post" | "square" | "story";
type ThemeId = "dark" | "light" | "festive" | "warm";

const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: "photo", label: "Photo ad", hint: "Your photo or an AI image + headline and button" },
  { id: "offer", label: "Offer / festival", hint: "Discount, code and a WhatsApp button" },
  { id: "proof", label: "Proof (real numbers)", hint: "Live totals from MECGURA, no client named" },
  { id: "tip", label: "Tip", hint: "A useful tip with three points" },
  { id: "compare", label: "Comparison", hint: "DIY tool vs MECGURA" },
  { id: "feature", label: "Feature + chat", hint: "A feature with a WhatsApp chat mock-up" },
];
const SIZES: Record<SizeId, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: "Post 4:5 (1080×1350)" },
  square: { w: 1080, h: 1080, label: "Square (1080×1080)" },
  story: { w: 1080, h: 1920, label: "Story / status (1080×1920)" },
};
const THEMES: Record<ThemeId, { label: string; bg: [string, string]; ink: string; muted: string; accent: string; accentInk: string; card: string; line: string }> = {
  dark: { label: "MECGURA dark", bg: ["#07110d", "#0d2a1f"], ink: "#effaf4", muted: "#9fb8ac", accent: "#34d399", accentInk: "#052e1f", card: "rgba(52,211,153,0.10)", line: "rgba(255,255,255,0.10)" },
  light: { label: "Clean light", bg: ["#f6fbf8", "#e3f6ec"], ink: "#0b2117", muted: "#4a6457", accent: "#0f9f6e", accentInk: "#ffffff", card: "rgba(15,159,110,0.08)", line: "rgba(11,33,23,0.10)" },
  festive: { label: "Festive", bg: ["#2a0838", "#5b1247"], ink: "#fff7e6", muted: "#f2cfa3", accent: "#f8b84e", accentInk: "#3b0a45", card: "rgba(248,184,78,0.12)", line: "rgba(255,255,255,0.12)" },
  warm: { label: "Warm", bg: ["#fff4e8", "#ffe1c4"], ink: "#2b1406", muted: "#7a4a2b", accent: "#e8590c", accentInk: "#ffffff", card: "rgba(232,89,12,0.08)", line: "rgba(43,20,6,0.10)" },
};

type Fields = { headline: string; sub: string; big: string; code: string; points: string; cta: string };
const DEFAULTS: Record<TemplateId, Fields> = {
  offer: { headline: "Festival offer on WhatsApp automation", sub: "Auto replies, broadcasts and lead follow-up. Set up by our team.", big: "20% OFF", code: "", points: "Official WhatsApp Business API\nSetup done by our team\nSupport in Punjabi & Hindi", cta: "WhatsApp: 78377 22567" },
  proof: { headline: "Real results, last 30 days", sub: "WhatsApp messages sent by businesses on MECGURA", big: "", code: "", points: "", cta: "Your business could be next · 78377 22567" },
  tip: { headline: "Customer messaged at 11 pm?", sub: "3 ways to never lose a WhatsApp lead", big: "", code: "", points: "Auto-reply in seconds, day and night\nSend the price list and catalogue automatically\nFollow up every lead the next morning", cta: "Free demo: 78377 22567" },
  compare: { headline: "Just software, or the full solution?", sub: "Everyone gives WhatsApp API. The difference is service.", big: "", code: "", points: "Setup|Do it yourself|Our team sets it up\nSupport|Ticket / email|WhatsApp + call, Punjabi & Hindi\nMeta bill|Separate card to Meta|One monthly package\nAutomation|Empty panel|Ready flows for your business", cta: "Free demo · 78377 22567 · mecgura.tech" },
  photo: { headline: "Never miss a customer on WhatsApp", sub: "Auto replies, broadcasts and lead follow-up. Set up by our team.", big: "", code: "", points: "", cta: "Free demo: 78377 22567" },
  feature: { headline: "Every lead gets a reply in 5 seconds", sub: "Click-to-WhatsApp ads + automatic follow-up", big: "", code: "", points: "Hi! Price of the gold package?\nHi Priya 👋 Gold package is ₹4,999/month. Want a free demo today?\nYes please!", cta: "Free demo: 78377 22567" },
};

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
function lines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}
/** Draws wrapped text and returns the y below it. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, font: string, color: string, weight = 700, lh = 1.12, align: CanvasTextAlign = "left") {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  let yy = y;
  for (const l of lines(ctx, s, maxW)) {
    ctx.fillText(l, align === "center" ? x + maxW / 2 : x, yy);
    yy += size * lh;
  }
  ctx.textAlign = "left";
  return yy;
}
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, lw = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}
function fit(ctx: CanvasRenderingContext2D, s: string, maxW: number, start: number, font: string, weight = 800) {
  let size = start;
  for (; size > 24; size -= 4) {
    ctx.font = `${weight} ${size}px ${font}`;
    if (ctx.measureText(s).width <= maxW) break;
  }
  return size;
}

type Proof = { days: number; messagesSent: number; deliveredRate: number; readRate: number; newContacts: number; activeClients: number; campaignsCompleted: number };

function draw(canvas: HTMLCanvasElement, o: { template: TemplateId; size: SizeId; theme: ThemeId; f: Fields; proof: Proof | null; logo: HTMLImageElement | null; photo: HTMLImageElement | null; display: string; sans: string }) {
  const { w, h } = SIZES[o.size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const t = THEMES[o.theme];
  const D = o.display;
  const S = o.sans;
  const pad = 80;
  const inner = w - pad * 2;
  const story = o.size === "story";
  const square = o.size === "square";

  // Background with a soft glow.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, t.bg[0]);
  g.addColorStop(1, t.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.9, 0, 0, w * 0.9, 0, w * 0.9);
  glow.addColorStop(0, `${t.accent}44`);
  glow.addColorStop(1, `${t.accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Header: logo (dark themes) or wordmark, and a pill.
  let y = story ? 220 : 72;
  const dark = o.theme === "dark" || o.theme === "festive";
  if (o.logo && dark) {
    const lh = 64;
    ctx.drawImage(o.logo, pad, y, (o.logo.width / o.logo.height) * lh, lh);
  } else {
    text(ctx, "MECGURA", pad, y + 10, 400, 40, D, t.ink, 800);
  }
  ctx.font = `600 24px ${S}`;
  const pill = "Official WhatsApp Business API";
  const pw = ctx.measureText(pill).width + 44;
  round(ctx, w - pad - pw, y + 6, pw, 52, 26, t.card, `${t.accent}66`);
  text(ctx, pill, w - pad - pw + 22, y + 19, pw, 24, S, t.accent, 600);
  y += 130;

  const f = o.f;
  const ctaH = 108;
  const bottom = h - (story ? 260 : 72);

  const top = y;
  // The body is drawn once invisibly to measure it, then centred between the header and the button
  // (the chat template fills the space itself).
  const drawBody = (): number => {
    let y = top;
      if (o.template === "offer") {
        const big = f.big || "20% OFF";
        const bs = fit(ctx, big, inner, story ? 220 : square ? 150 : 190, D);
        y = text(ctx, big, pad, y, inner, bs, D, t.accent, 800, 1);
        y = text(ctx, f.headline, pad, y + 20, inner, square ? 56 : 64, D, t.ink, 800, 1.08);
        y = text(ctx, f.sub, pad, y + 18, inner, 32, S, t.muted, 500, 1.35);
        if (f.code) {
          ctx.font = `800 40px ${D}`;
          const cw = ctx.measureText(f.code).width + 80;
          ctx.setLineDash([12, 10]);
          round(ctx, pad, y + 36, cw + 150, 86, 18, t.card, t.accent, 3);
          ctx.setLineDash([]);
          text(ctx, "CODE", pad + 30, y + 64, 120, 26, S, t.muted, 700);
          text(ctx, f.code, pad + 130, y + 58, cw, 40, D, t.ink, 800);
          y += 140;
        } else y += 30;
        // Benefits fill the space above the button.
        const pts = f.points.split("\n").filter(Boolean).slice(0, 4);
        const room = bottom - ctaH - 40 - y;
        const rowH = square ? 58 : 76;
        let py = y + Math.max(0, (room - pts.length * rowH) / 2);
        for (const pt of pts) {
          if (py + rowH > bottom - ctaH - 20) break;
          ctx.beginPath();
          ctx.arc(pad + 22, py + 22, 22, 0, Math.PI * 2);
          ctx.fillStyle = t.accent;
          ctx.fill();
          text(ctx, "✓", pad, py + 6, 44, 28, S, t.accentInk, 800, 1, "center");
          text(ctx, pt, pad + 64, py + 4, inner - 64, square ? 30 : 34, S, t.ink, 600, 1.2);
          py += rowH;
        }
      } else if (o.template === "proof") {
        y = text(ctx, f.headline, pad, y, inner, square ? 60 : 72, D, t.ink, 800, 1.06);
        y = text(ctx, f.sub, pad, y + 12, inner, 30, S, t.muted, 500, 1.35) + 30;
        const p = o.proof;
        const stats = p
          ? [
              { v: formatNumber(p.messagesSent), l: "WhatsApp messages sent" },
              { v: `${p.readRate}%`, l: "of messages were read" },
              { v: formatNumber(p.newContacts), l: "new customers captured" },
              { v: `${p.deliveredRate}%`, l: "delivered" },
            ]
          : [{ v: "…", l: "Loading numbers" }];
        const cols = 2;
        const gap = 24;
        const cw = (inner - gap) / cols;
        const ch = square ? 190 : story ? 280 : 230;
        stats.forEach((s, i) => {
          const cx = pad + (i % cols) * (cw + gap);
          const cy = y + Math.floor(i / cols) * (ch + gap);
          round(ctx, cx, cy, cw, ch, 28, t.card, t.line);
          const vs = fit(ctx, s.v, cw - 60, square ? 76 : 96, D);
          text(ctx, s.v, cx + 30, cy + 34, cw - 60, vs, D, t.accent, 800, 1);
          text(ctx, s.l, cx + 30, cy + ch - 76, cw - 60, 26, S, t.muted, 600, 1.2);
        });
      } else if (o.template === "tip") {
        y = text(ctx, f.headline, pad, y, inner, square ? 64 : 76, D, t.ink, 800, 1.05);
        y = text(ctx, f.sub, pad, y + 16, inner, 34, S, t.accent, 700, 1.3) + 34;
        f.points
          .split("\n")
          .filter(Boolean)
          .slice(0, 4)
          .forEach((pt, i) => {
            round(ctx, pad, y, 64, 64, 32, t.accent);
            text(ctx, String(i + 1), pad, y + 13, 64, 36, D, t.accentInk, 800, 1, "center");
            const ny = text(ctx, pt, pad + 92, y + 8, inner - 92, square ? 32 : 36, S, t.ink, 600, 1.3);
            y = Math.max(ny, y + 64) + (square ? 22 : 34);
          });
      } else if (o.template === "compare") {
        y = text(ctx, f.headline, pad, y, inner, square ? 54 : 64, D, t.ink, 800, 1.06);
        y = text(ctx, f.sub, pad, y + 12, inner, 28, S, t.muted, 500, 1.35) + 30;
        const rows = f.points
          .split("\n")
          .map((r) => r.split("|"))
          .filter((r) => r.length === 3)
          .slice(0, 5);
        const c0 = 190;
        const c1 = (inner - c0) * 0.44;
        const c2 = inner - c0 - c1;
        const x1 = pad + c0;
        const x2 = x1 + c1;
        text(ctx, "DIY TOOL", x1 + 16, y, c1, 22, S, t.muted, 700);
        round(ctx, x2, y - 18, c2, 60, 18, t.accent);
        text(ctx, "MECGURA", x2 + 22, y, c2, 24, S, t.accentInk, 800);
        y += 50;
        const rh = square ? 104 : story ? 150 : 124;
        round(ctx, x2, y - 8, c2, rows.length * rh + 8, 0, t.card);
        rows.forEach(([a, b, c], i) => {
          const ry = y + i * rh;
          ctx.fillStyle = t.line;
          ctx.fillRect(pad, ry - 8, inner, 2);
          text(ctx, a, pad, ry + 22, c0 - 16, 26, S, t.ink, 700, 1.2);
          text(ctx, `✕  ${b}`, x1 + 16, ry + 22, c1 - 24, 25, S, t.muted, 500, 1.25);
          text(ctx, `✓  ${c}`, x2 + 22, ry + 22, c2 - 40, 25, S, t.ink, 700, 1.25);
        });
      } else if (o.template === "photo") {
        // Photo on top (cover-cropped, rounded), headline and second line under it.
        const textH = (square ? 56 : 66) * 2.3 + 90;
        const ph = Math.max(200, bottom - ctaH - 50 - y - textH);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pad, y, inner, ph, 32);
        ctx.clip();
        if (o.photo) {
          const sc = Math.max(inner / o.photo.width, ph / o.photo.height);
          const dw = o.photo.width * sc;
          const dh = o.photo.height * sc;
          ctx.drawImage(o.photo, pad + (inner - dw) / 2, y + (ph - dh) / 2, dw, dh);
        } else {
          ctx.fillStyle = t.card;
          ctx.fillRect(pad, y, inner, ph);
          text(ctx, "Upload a photo or pick one from AI studio", pad, y + ph / 2 - 20, inner, 30, S, t.muted, 600, 1.2, "center");
        }
        ctx.restore();
        y = text(ctx, f.headline, pad, y + ph + 34, inner, square ? 56 : 66, D, t.ink, 800, 1.06);
        y = text(ctx, f.sub, pad, y + 12, inner, 30, S, t.muted, 500, 1.3);
      } else {
        y = text(ctx, f.headline, pad, y, inner, square ? 60 : 72, D, t.ink, 800, 1.06);
        y = text(ctx, f.sub, pad, y + 14, inner, 32, S, t.accent, 700, 1.3) + 36;
        // Phone-style chat card.
        const msgs = f.points.split("\n").filter(Boolean).slice(0, 4);
        const cardH = Math.min(bottom - ctaH - 40 - y, 160 + msgs.length * 150);
        round(ctx, pad, y, inner, cardH, 32, "#efeae2");
        round(ctx, pad, y, inner, 100, 32, "#075e54");
        ctx.fillStyle = "#075e54";
        ctx.fillRect(pad, y + 60, inner, 40);
        ctx.beginPath();
        ctx.arc(pad + 60, y + 50, 28, 0, Math.PI * 2);
        ctx.fillStyle = "#25d366";
        ctx.fill();
        text(ctx, "Your Business", pad + 104, y + 24, inner, 30, S, "#ffffff", 700);
        text(ctx, "online", pad + 104, y + 60, inner, 22, S, "#cfe9e4", 500);
        let my = y + 130;
        msgs.forEach((m, i) => {
          const mine = i % 2 === 1;
          ctx.font = `500 28px ${S}`;
          const ls = lines(ctx, m, inner * 0.62);
          const bw = Math.min(inner * 0.7, Math.max(...ls.map((l) => ctx.measureText(l).width)) + 48);
          const bh = ls.length * 36 + 36;
          if (my + bh > y + cardH - 20) return;
          const bx = mine ? pad + inner - bw - 28 : pad + 28;
          round(ctx, bx, my, bw, bh, 18, mine ? "#d9fdd3" : "#ffffff");
          text(ctx, m, bx + 24, my + 18, inner * 0.62, 28, S, "#111b21", 500, 1.28);
          my += bh + 22;
        });
      }
    return y;
  };
  ctx.save();
  ctx.globalAlpha = 0;
  const end = drawBody();
  ctx.restore();
  const gap = o.template === "feature" || o.template === "offer" || o.template === "photo" ? 0 : Math.max(0, (bottom - ctaH - 40 - end) / 2);
  ctx.save();
  ctx.translate(0, Math.min(gap, story ? 220 : 160));
  drawBody();
  ctx.restore();

  // Call to action.
  round(ctx, pad, bottom - ctaH, inner, ctaH, 26, t.accent);
  const cs = fit(ctx, f.cta, inner - 60, 40, D);
  text(ctx, f.cta, pad, bottom - ctaH + (ctaH - cs) / 2, inner, cs, D, t.accentInk, 800, 1, "center");
}

export function CreativeMaker({ imageId = null }: { imageId?: string | null }) {
  const toast = useToast();
  const [photo, setPhoto] = React.useState<HTMLImageElement | null>(null);
  const loadPhoto = React.useCallback((src: string) => {
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => toast("Couldn't open that image", "error");
    img.src = src;
  }, [toast]);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const probe = React.useRef<HTMLSpanElement>(null);
  const [template, setTemplate] = React.useState<TemplateId>(imageId ? "photo" : "offer");
  const [size, setSize] = React.useState<SizeId>("post");
  const [theme, setTheme] = React.useState<ThemeId>("dark");
  const [fields, setFields] = React.useState<Record<TemplateId, Fields>>(DEFAULTS);
  const [proof, setProof] = React.useState<Proof | null>(null);
  const [logo, setLogo] = React.useState<HTMLImageElement | null>(null);
  const [fonts, setFonts] = React.useState<{ display: string; sans: string } | null>(null);
  const f = fields[template];

  // Fonts, logo, real numbers and the next festival offer.
  React.useEffect(() => {
    const el = probe.current;
    const display = el ? getComputedStyle(el).fontFamily : "sans-serif";
    const sans = getComputedStyle(document.body).fontFamily || "sans-serif";
    void Promise.all([document.fonts.load(`800 60px ${display}`), document.fonts.load(`600 30px ${sans}`)])
      .catch(() => undefined)
      .then(() => setFonts({ display, sans }));
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = "/logo.png";
    void apiFetch<Proof>("/api/admin/marketing/proof").then((r) => r.ok && setProof(r.data));
    void apiFetch<{ festivals: { name: string; emoji: string; start: string; discountPercent: number; offerCode: string }[] }>("/api/admin/festivals").then((r) => {
      if (!r.ok) return;
      const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      const next = r.data.festivals.filter((x) => x.start >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
      if (next)
        setFields((p) => ({
          ...p,
          offer: { ...p.offer, headline: `${next.emoji} ${next.name} offer on WhatsApp automation`.trim(), big: next.discountPercent ? `${next.discountPercent}% OFF` : p.offer.big, code: next.offerCode || p.offer.code },
        }));
    });
  }, []);

  React.useEffect(() => {
    if (canvasRef.current && fonts) draw(canvasRef.current, { template, size, theme, f, proof, logo, photo, ...fonts });
  }, [template, size, theme, f, proof, logo, photo, fonts]);

  // Opened from AI studio with an image.
  React.useEffect(() => {
    if (imageId && /^[A-Za-z0-9_-]{1,64}$/.test(imageId)) loadPhoto(`/api/admin/marketing/images/${imageId}`);
  }, [imageId, loadPhoto]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((p) => ({ ...p, [template]: { ...p[template], [k]: e.target.value } }));

  function download() {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return toast("Couldn't create the image", "error");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mecgura-${template}-${size}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <span ref={probe} className="font-display pointer-events-none absolute opacity-0" aria-hidden="true">
        MECGURA
      </span>
      <Card className="order-2 lg:order-1">
        <CardHeader title="Design" description="Pick a template, size and colours, change the text, then download." />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-small font-medium text-app-text">Template</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" aria-pressed={template === x.id} onClick={() => setTemplate(x.id)} className={cn("rounded-lg border p-3 text-left", template === x.id ? "border-app-primary/60 bg-app-primary/10" : "border-app-border hover:border-app-primary/30")}>
                  <span className="block text-small font-semibold text-app-text">{x.label}</span>
                  <span className="block text-caption text-app-subtle">{x.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cm-size" label="Size">
              <Select value={size} onChange={(e) => setSize(e.target.value as SizeId)}>
                {Object.entries(SIZES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cm-theme" label="Colours">
              <Select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
                {Object.entries(THEMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="cm-headline" label="Headline">
            <Input value={f.headline} onChange={set("headline")} maxLength={90} />
          </Field>
          <Field id="cm-sub" label="Second line">
            <Input value={f.sub} onChange={set("sub")} maxLength={140} />
          </Field>
          {template === "offer" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="cm-big" label="Big text">
                <Input value={f.big} onChange={set("big")} maxLength={14} />
              </Field>
              <Field id="cm-code" label="Offer code (optional)">
                <Input value={f.code} onChange={set("code")} maxLength={16} />
              </Field>
            </div>
          ) : null}
          {template !== "proof" && template !== "photo" ? (
            <Field id="cm-points" label={template === "tip" || template === "offer" ? "Points (one per line)" : template === "compare" ? "Rows: topic|DIY tool|MECGURA (one per line)" : "Chat messages (customer, you, customer…)"}>
              <Textarea rows={5} value={f.points} onChange={set("points")} maxLength={600} />
            </Field>
          ) : null}
          {template === "photo" ? (
            <Field id="cm-photo" label="Photo" hint="Your own photo, or make one in AI studio and press its 'Use in Creative maker' button.">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadPhoto(URL.createObjectURL(file));
                }}
              />
            </Field>
          ) : null}
          {template === "proof" ? (
            <p className="text-caption text-app-subtle">
              Numbers are live totals from all client workspaces in the last 30 days (demo numbers excluded). No client is named.
              {proof && proof.messagesSent === 0 ? " Nothing sent yet this month, so they show 0." : ""}
            </p>
          ) : null}
          <Field id="cm-cta" label="Button text">
            <Input value={f.cta} onChange={set("cta")} maxLength={60} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={download}>
              <Download /> Download PNG
            </Button>
            <Button variant="ghost" onClick={() => setFields((p) => ({ ...p, [template]: DEFAULTS[template] }))}>
              <RefreshCw /> Reset text
            </Button>
          </div>
        </CardBody>
      </Card>
      <div className="order-1 lg:order-2">
        <div className="sticky top-4 rounded-[var(--radius-card)] border border-app-border bg-black/30 p-3">
          <canvas ref={canvasRef} className="mx-auto block h-auto max-h-[75vh] w-full max-w-full object-contain" style={{ aspectRatio: `${SIZES[size].w} / ${SIZES[size].h}` }} aria-label="Creative preview" role="img" />
        </div>
      </div>
    </div>
  );
}
