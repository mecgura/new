import { useState } from 'react'

// Official MECGURA logo from /public/brand. Falls back to a plain text wordmark until the file is added.
const SOURCES = ['/brand/mecgura-logo.svg', '/brand/mecgura-logo.png']

export default function Logo({ className = 'h-8', showProduct = true }: { className?: string; showProduct?: boolean }) {
  const [i, setI] = useState(0)
  const src = SOURCES[i]
  return (
    <span className="inline-flex items-center gap-2.5">
      {src ? (
        <img src={src} alt="MECGURA" className={`${className} w-auto object-contain`} onError={() => setI((n) => n + 1)} />
      ) : (
        <span className="font-display text-lg font-extrabold tracking-[0.14em] text-white">MECGURA</span>
      )}
      {showProduct && <span className="rounded-md border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-2">WhatsApp</span>}
    </span>
  )
}
