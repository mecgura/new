import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-5 py-20 text-center">
      <p className="font-display text-7xl font-bold text-brand-600 dark:text-brand-400/25">404</p>
      <h1 className="font-display mt-4 text-2xl font-bold text-[#0C160D] dark:text-[#f4f4f6] sm:text-3xl">Page not found</h1>
      <p className="mt-3 text-black dark:text-[#f4f4f6]">
        The page you&apos;re looking for doesn&apos;t exist or was moved. Let&apos;s get you back on track.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/dashboard" className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-400 px-6 text-sm font-semibold text-[#062026] hover:bg-brand-300">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
