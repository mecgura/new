import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-3xl items-center justify-between px-page py-4"><Logo name="MECGURA" sub="HEALTH" /><Link href="/login" className="type-secondary">Back to sign in</Link></div></header>
      <main id="main" className="mx-auto max-w-3xl px-page py-10">{children}</main>
      <footer className="mx-auto max-w-3xl px-page pb-10"><nav aria-label="Legal" className="type-caption flex gap-4"><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link></nav></footer>
    </div>
  );
}
