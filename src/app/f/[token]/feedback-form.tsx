"use client";

import * as React from "react";

const LABELS = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

export function FeedbackForm({ token, firstName, business, alreadyRated, hasReviewLink }: { token: string; firstName: string; business: string; alreadyRated: number | null; hasReviewLink: boolean }) {
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [state, setState] = React.useState<"form" | "sending" | "done">(alreadyRated ? "done" : "form");
  const [low, setLow] = React.useState(Boolean(alreadyRated && alreadyRated <= 3));
  const [error, setError] = React.useState("");

  async function submit() {
    setState("sending");
    setError("");
    const res = await fetch(`/api/f/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, comment }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { low?: boolean; error?: string };
    if (!res?.ok && res?.status !== 409) {
      setError(body.error ?? "Couldn't send. Please try again.");
      return setState("form");
    }
    setLow(Boolean(body.low));
    setState("done");
  }

  const google = hasReviewLink ? (
    <a href={`/api/f/${token}/google`} className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800">
      Write a review on Google
    </a>
  ) : null;

  if (state === "done") {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-bold">{low ? "Thank you for telling us" : "Thank you! 🙏"}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#45584d]">
          {low ? `We're sorry it wasn't great. The ${business} team has your message and will get in touch to make it right.` : `It means a lot to the ${business} team.`}
          {hasReviewLink ? " If you have a minute, a public review on Google helps other people find us." : ""}
        </p>
        {google}
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <div>
      <h1 className="mt-2 text-2xl font-bold">Hi {firstName}, how was your experience?</h1>
      <p className="mt-1 text-[15px] text-[#45584d]">Tap a star. It takes 10 seconds.</p>
      <div className="mt-5 flex justify-between gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}: ${LABELS[n]}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="flex size-14 items-center justify-center rounded-2xl text-4xl transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
          >
            <span className={n <= shown ? "text-amber-400" : "text-[#d9d3c5]"} aria-hidden="true">★</span>
          </button>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-sm font-medium text-[#45584d]">{shown ? LABELS[shown] : ""}</p>
      <label htmlFor="fb-comment" className="mt-4 block text-sm font-medium">Anything you&apos;d like to tell us? (optional)</label>
      <textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} className="mt-1.5 w-full rounded-xl border border-[#d9d3c5] px-3 py-2 text-[15px] outline-none focus:border-emerald-700" />
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button type="button" disabled={!rating || state === "sending"} onClick={() => void submit()} className="mt-4 h-12 w-full rounded-xl bg-[#10231a] text-base font-semibold text-white disabled:opacity-40">
        {state === "sending" ? "Sending…" : "Send feedback"}
      </button>
      <p className="mt-4 text-center text-xs text-[#7b8a80]">Your answer goes only to {business}.</p>
    </div>
  );
}
