"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-5 py-20 text-center">
      <h1 className="font-display text-2xl font-bold text-[#0C160D] dark:text-[#f4f4f6] sm:text-3xl">Something went wrong</h1>
      <p className="mt-3 text-black dark:text-[#f4f4f6]">
        An unexpected error occurred. Please try again — or contact us directly and we&apos;ll help.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-400 px-6 text-sm font-semibold text-[#062026] hover:bg-brand-300"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex h-11 items-center justify-center rounded-lg border border-[#CBD6CB] dark:border-[#2c2c3a] px-6 text-sm font-semibold text-[#0C160D] dark:text-[#f4f4f6] hover:border-brand-400/50">
          Back to home
        </Link>
      </div>
    </div>
  );
}
