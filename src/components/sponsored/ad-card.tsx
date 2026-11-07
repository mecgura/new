import { Badge, type BadgeTone } from "@/components/ds";
import type { Phase } from "@/services/sponsored/sponsored";

export const PHASE_LABEL: Record<Phase, string> = { draft: "Draft", pending: "In review", rejected: "Needs changes", paused: "Paused", scheduled: "Scheduled", live: "Live", ended: "Ended" };
export const PHASE_TONE: Record<Phase, BadgeTone> = { draft: "neutral", pending: "info", rejected: "danger", paused: "warning", scheduled: "info", live: "success", ended: "neutral" };

export const PhaseBadge = ({ phase }: { phase: Phase }) => <Badge tone={PHASE_TONE[phase]} dot>{PHASE_LABEL[phase]}</Badge>;

/** How the card looks on mecgura.tech (same words and layout as the real panel). */
export function AdPreview({ headline, body, ctaLabel, advertiser, imageUrl }: { headline: string; body: string; ctaLabel: string; advertiser: string; imageUrl: string | null }) {
  return (
    <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-xl border border-app-border bg-white text-[#0b1f1a] shadow-sm">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" />
      ) : (
        <div className="grid aspect-[1.91/1] w-full place-items-center bg-[#e7f5ef] text-caption text-[#4b6b61]">Your image (optional)</div>
      )}
      <div className="p-4">
        <p className="text-caption text-[#4b6b61]">Sponsored · {advertiser}</p>
        <p className="mt-1 font-bold leading-snug">{headline || "Your headline"}</p>
        {body ? <p className="mt-1 text-small text-[#4b6b61]">{body}</p> : null}
        <span className="mt-3 flex min-h-10 w-full items-center justify-center rounded-lg border border-[#128c7e] text-small font-semibold text-[#128c7e]">{ctaLabel || "Learn more"}</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className="flex h-10 items-end gap-0.5">
      {values.map((v, i) => (
        <span key={i} className="w-1.5 rounded-sm bg-app-primary/70" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}
