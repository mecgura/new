"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type EffectKind = "fireworks" | "diyas" | "petals" | "colors" | "snow" | "confetti" | "none";

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; rot: number; vr: number; kind: number };

const FIRE = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#f72585", "#ffb703", "#ffffff"];
const PETAL = ["#ff9f1c", "#ffbf69", "#ff6b6b", "#f94144", "#f8961e", "#ffd6a5"];
const HOLI = ["#f72585", "#7209b7", "#3a0ca3", "#4cc9f0", "#06d6a0", "#ffd60a", "#fb5607"];
const CONF = ["#25d366", "#128c7e", "#ffd166", "#ef476f", "#4cc9f0", "#ffffff"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/**
 * A short full-screen celebration drawn on a canvas: fireworks, diyas, petals, Holi colours, snow or
 * confetti. It never blocks clicks, stops by itself after `seconds`, can be closed, and does not run
 * for people who ask their device for reduced motion.
 */
export function FestivalEffect({ kind, seconds = 7, onDone }: { kind: EffectKind; seconds?: number; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (kind === "none" || !on) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => {
        setOn(false);
        onDone?.();
      });
      return () => cancelAnimationFrame(id);
    }
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const parts: P[] = [];
    const rockets: P[] = [];
    const small = w < 640;
    const started = performance.now();
    const endAt = started + seconds * 1000;
    let lastSpawn = 0;
    let raf = 0;

    const burst = (x: number, y: number) => {
      const color = pick(FIRE);
      const n = small ? 60 : 100;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const s = 1.8 + Math.random() * (small ? 3.2 : 4.4);
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 55 + Math.random() * 35, size: 2.6 + Math.random() * 2, color: Math.random() < 0.15 ? "#ffe8a3" : color, rot: 0, vr: 0, kind: 0 });
      }
    };

    const spawn = (t: number) => {
      const spawning = t < endAt - 1200;
      if (kind === "fireworks") {
        if (spawning && t - lastSpawn > (small ? 420 : 300)) {
          lastSpawn = t;
          rockets.push({ x: w * (0.15 + Math.random() * 0.7), y: h, vx: (Math.random() - 0.5) * 1.2, vy: -(h * 0.011 + Math.random() * 4), life: 0, max: h * (0.15 + Math.random() * 0.4), size: 2.4, color: "#ffe8a3", rot: 0, vr: 0, kind: 0 });
        }
      } else if (kind === "diyas") {
        if (spawning && Math.random() < 0.6) parts.push({ x: Math.random() * w, y: h + 10, vx: (Math.random() - 0.5) * 0.4, vy: -(0.6 + Math.random() * 1.4), life: 0, max: 200 + Math.random() * 120, size: 1.5 + Math.random() * 2.5, color: pick(["#ffd166", "#ffb703", "#fb8500", "#fff1a8"]), rot: 0, vr: 0, kind: 1 });
      } else if (kind === "petals") {
        if (spawning && Math.random() < 0.45) parts.push({ x: Math.random() * w, y: -20, vx: (Math.random() - 0.5) * 1, vy: 1 + Math.random() * 1.6, life: 0, max: 600, size: 6 + Math.random() * 6, color: pick(PETAL), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.08, kind: 2 });
      } else if (kind === "colors") {
        if (spawning && t - lastSpawn > 260) {
          lastSpawn = t;
          const x = Math.random() * w;
          const y = Math.random() * h * 0.8;
          const c = pick(HOLI);
          for (let i = 0; i < (small ? 14 : 22); i++) {
            const a = Math.random() * Math.PI * 2;
            const s = Math.random() * 2.4;
            parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 80 + Math.random() * 40, size: 14 + Math.random() * 26, color: c, rot: 0, vr: 0, kind: 3 });
          }
        }
      } else if (kind === "snow") {
        if (spawning && Math.random() < 0.7) parts.push({ x: Math.random() * w, y: -10, vx: (Math.random() - 0.5) * 0.6, vy: 0.6 + Math.random() * 1.3, life: 0, max: 900, size: 1.5 + Math.random() * 3, color: "#ffffff", rot: 0, vr: 0, kind: 4 });
      } else if (kind === "confetti") {
        if (spawning && Math.random() < 0.8) parts.push({ x: Math.random() * w, y: -12, vx: (Math.random() - 0.5) * 2, vy: 1.6 + Math.random() * 2.4, life: 0, max: 600, size: 5 + Math.random() * 5, color: pick(CONF), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25, kind: 5 });
      }
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      spawn(t);
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.09;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.size, 0, Math.PI * 2);
        ctx.fill();
        if (r.vy >= -0.5 || r.y <= r.max) {
          burst(r.x, r.y);
          rockets.splice(i, 1);
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const fade = Math.max(0, 1 - p.life / p.max);
        if (p.kind === 0) {
          p.vx *= 0.985;
          p.vy = p.vy * 0.985 + 0.045;
          ctx.globalAlpha = fade;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + fade * 0.5), 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 1) {
          p.x += Math.sin((p.life + i) / 18) * 0.4;
          ctx.globalAlpha = fade * (0.6 + Math.sin(p.life / 5) * 0.4);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (p.kind === 3) {
          p.vx *= 0.96;
          p.vy *= 0.96;
          ctx.globalAlpha = fade * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + (1 - fade) * 0.8), 0, Math.PI * 2);
          ctx.fill();
        } else {
          if (p.kind === 2 || p.kind === 4) p.x += Math.sin((p.life + i * 7) / 30) * 0.6;
          ctx.globalAlpha = Math.min(1, fade * 3) * 0.95;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          if (p.kind === 2) ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
          else if (p.kind === 4) ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          else ctx.rect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.fill();
          ctx.restore();
        }
        if (p.life > p.max || p.y > h + 40 || p.y < -60) parts.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      if (t < endAt || parts.length || rockets.length) {
        if (t < endAt + 4000) {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
      setOn(false);
      onDone?.();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [kind, seconds, on, onDone]);

  if (kind === "none" || !on) return null;
  return (
    <>
      <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />
      <button
        type="button"
        onClick={() => {
          setOn(false);
          onDone?.();
        }}
        className="fixed right-3 top-3 z-[61] inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
      >
        <X className="size-3.5" aria-hidden="true" /> Stop effect
      </button>
    </>
  );
}
