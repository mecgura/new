import Link from "next/link";
import { Logo } from "@/components/layout/logo";

const LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/data-deletion", label: "Data deletion" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-root dark min-h-dvh px-4 py-10">
      <main id="main-content" className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Logo tone="dark" />
          <Link href="/login" className="text-sm font-semibold text-brand-400 hover:underline">
            Sign in
          </Link>
        </div>
        <article className="space-y-6 text-[15px] leading-7 [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand-400 [&_a]:underline">
          {children}
        </article>
        <nav aria-label="Legal" className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-sm opacity-80">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
