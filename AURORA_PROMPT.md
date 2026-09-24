# Aurora — Landing Page Hero Rebuild Prompt (v2)

> One-shot prompt for an AI code generator (Claude Code, Cursor, v0, Bolt, etc.). Paste this whole file as one prompt. It contains the complete source of every file. Follow it literally: the result should build with zero errors and match the original design on desktop, and also work on mobile.

## What changed from v1

- **Video never breaks:** the hero `<video>` tries `public/hero.mp4` first and falls back to streaming the hosted R2 URL, so the page works even if the download is blocked or skipped.
- **Mobile ready:** fluid padding with `clamp()`, nav links hide below 768px (Tailwind `hidden md:flex`), hero uses `100svh` with a `560px` minimum, background glow is capped to the screen width. No horizontal scroll at 390px.
- **Accessibility:** framer-motion `MotionConfig reducedMotion="user"` respects the OS "reduce motion" setting; the logo has an accessible label; social icons open real profile URLs in a new tab.
- **Truly one-shot:** `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `.gitignore` and the favicon are included, so no scaffolding step is needed.
- **Cleanup:** removed the duplicate `index.css` import from `App.tsx`.

The desktop design (colors, fonts, sizes, spacing, animation timings) is unchanged.

## What this project is

"Aurora" is a design-studio-style landing page. Dark background video hero, content anchored to the top-left (not centered), a white "Design That Lights the Way" headline in Plus Jakarta Sans, a trusted-by avatar badge, a dark "Get Started" pill + circular play button, and social icons pinned to the bottom-left corner. Accent color is emerald green (`#10b981` → `#047857`) used only in the avatar stack and the background glow. The navbar has a white line-art car logo and a white "Contact Us" pill on a transparent bar.

## Quick customization (for reusing this for a client)

Change only these values; everything else stays as is:

| What | Where |
|---|---|
| Brand name / tab title | `<title>` in `index.html`, `aria-label` on the logo in `Navbar.tsx`, the paragraph in `Hero.tsx` |
| Logo | the `<svg>` in `Navbar.tsx` (keep 34×34, white stroke) |
| Nav links | `navLinks` array in `Navbar.tsx` |
| Headline + subtext | `motion.h1` and `motion.p` in `Hero.tsx` |
| Badge text | the `<span>` inside the first `motion.div` in `Hero.tsx` |
| Accent color | `#10b981` / `#047857` (avatars) and `rgba(6,95,70,0.18)` (glow) in `Hero.tsx` |
| Video | `public/hero.mp4` + the fallback `<source>` URL in `Hero.tsx` |
| Social links | `href` values in the `socials` array in `Hero.tsx` |

## Tech stack (required, do not substitute)

- Vite + React 19 + TypeScript
- Tailwind CSS **v4** through the `@tailwindcss/vite` plugin (no `tailwind.config.js`). CSS comes in with one `@import "tailwindcss";` at the top of `src/index.css`
- `framer-motion` for all animation (fade/slide-in on mount, hover/tap scale on buttons)
- Typography and component styling inline via the `style` prop. Tailwind utility classes are used only for layout helpers (`w-full min-h-screen`, `hidden md:flex`)
- Google Fonts via `<link>` tags in `index.html`, no local font files

## Steps to build

1. Create an empty folder named `aurora` and create every file below with exactly the given contents.
2. Run `npm install`.
3. Download the hero video: `curl -L https://pub-1e5b4001b36b47e28e6a2fb775966a79.r2.dev/templates/aurora/hero.mp4 -o public/hero.mp4`. If the download fails (blocked network), continue anyway: the page streams the same video from that URL.
4. Run `npm run build` and `npm run lint`. Both must pass with zero errors. Then `npm run dev` to view.
5. There is **no** `TrustedBy.tsx` component. The trusted-by badge is inline inside `Hero.tsx`.

## File: `package.json`

```json
{
  "name": "aurora",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.4",
    "@tailwindcss/vite": "^4.2.2",
    "@types/node": "^24.12.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^9.39.4",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "framer-motion": "^12.38.0",
    "globals": "^17.4.0",
    "tailwindcss": "^4.2.2",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.57.0",
    "vite": "^8.0.1"
  }
}
```

## File: `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
```

## File: `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

## File: `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

## File: `tsconfig.node.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "types": ["node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

## File: `eslint.config.js`

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
```

## File: `.gitignore`

```text
node_modules
dist
dist-ssr
*.local
.DS_Store
```

## File: `public/favicon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#047857"/><circle cx="16" cy="16" r="7" fill="#10b981"/></svg>
```

## File: `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aurora</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## File: `src/vite-env.d.ts`

```ts
/// <reference types="vite/client" />
```

## File: `src/index.css`

```css
@import "tailwindcss";

@layer base {
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  html { scroll-behavior: smooth; }
  body {
    font-family: 'Inter', sans-serif;
    background: #000;
    color: #fff;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  #root { width: 100%; min-height: 100svh; }
}
```

## File: `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

## File: `src/App.tsx`

```tsx
import { MotionConfig } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="w-full min-h-screen">
        <Navbar />
        <Hero />
      </div>
    </MotionConfig>
  )
}

export default App
```

## File: `src/components/Navbar.tsx`

```tsx
import { motion } from 'framer-motion'

const navLinks = ["Product", "Pricing", "Docs", "Contact"]

export default function Navbar() {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(18px, 3vw, 26px) clamp(20px, 4vw, 44px)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '44px' }}>
        <svg aria-label="Aurora" role="img" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11 1 11.9 1 13v3c0 .6.4 1 1 1h2" />
          <circle cx="7" cy="17" r="2" />
          <path d="M9 17h6" />
          <circle cx="17" cy="17" r="2" />
        </svg>
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: '30px' }}>
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              style={{ fontSize: '14px', fontWeight: 500, fontFamily: "'Inter', sans-serif", color: 'rgba(255,255,255,0.82)', textDecoration: 'none' }}
            >
              {link}
            </a>
          ))}
        </div>
      </div>
      <motion.a
        href="#contact"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        style={{
          padding: '11px 24px',
          borderRadius: '999px',
          fontSize: '14px',
          fontWeight: 600,
          fontFamily: "'Inter', sans-serif",
          color: '#111',
          textDecoration: 'none',
          background: '#fff',
          boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
        }}
      >
        Contact Us
      </motion.a>
    </motion.nav>
  )
}
```

## File: `src/components/Hero.tsx`

```tsx
import { motion } from 'framer-motion'

const socials = [
  {
    label: 'X',
    href: 'https://x.com',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    label: 'LinkedIn',
    href: 'https://linkedin.com',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.554V9h3.565v11.452z',
  },
  {
    label: 'Instagram',
    href: 'https://instagram.com',
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM12 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z',
  },
]

export default function Hero() {
  return (
    <section style={{ position: 'relative', width: '100%', height: '100svh', minHeight: '560px', overflow: 'hidden' }}>
      <video style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} autoPlay muted loop playsInline>
        <source src="/hero.mp4" type="video/mp4" />
        <source src="https://pub-1e5b4001b36b47e28e6a2fb775966a79.r2.dev/templates/aurora/hero.mp4" type="video/mp4" />
      </video>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.10)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.13) 0%, transparent 22%, transparent 60%, rgba(0,0,0,0.19) 100%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,0.07) 0%, transparent 18%, transparent 82%, rgba(0,0,0,0.07) 100%)' }} />
      <div style={{ position: 'absolute', top: '-14%', left: '50%', transform: 'translateX(-50%)', width: 'min(1000px, 160vw)', height: '720px', background: 'radial-gradient(ellipse at 50% 30%, rgba(6,95,70,0.18) 0%, transparent 68%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-start', paddingTop: '24vh', paddingLeft: 'clamp(20px, 5vw, 64px)', paddingRight: '24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', borderRadius: '999px', padding: '6px 16px 6px 6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', width: 'fit-content' }}
        >
          <div style={{ display: 'flex' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: '22px', height: '22px', borderRadius: '999px', background: 'linear-gradient(135deg, #10b981, #047857)', border: '2px solid rgba(10,20,16,0.9)', marginLeft: i === 0 ? 0 : '-8px' }} />
            ))}
          </div>
          <span style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.75)', fontFamily: "'Inter', sans-serif" }}>
            We&apos;re trusted by <strong style={{ color: '#fff', fontWeight: 600 }}>teams worldwide</strong>
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25, ease: 'easeOut' }}
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, fontSize: 'clamp(2.4rem, 4.6vw, 4.1rem)', lineHeight: 1.08, letterSpacing: '-0.02em', color: '#fff', marginTop: '22px', maxWidth: '560px' }}
        >
          Design That<br />Lights the Way
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.42, ease: 'easeOut' }}
          style={{ marginTop: '16px', fontSize: '15px', lineHeight: 1.6, color: 'rgba(255,255,255,0.6)', fontFamily: "'Inter', sans-serif", maxWidth: '340px' }}
        >
          Aurora helps modern brands craft interfaces that feel effortless and alive.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.58, ease: 'easeOut' }}
          style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '30px' }}
        >
          <motion.a
            href="#contact"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ padding: '14px 26px', borderRadius: '999px', background: '#0a0a0a', color: '#fff', fontSize: '14px', fontWeight: 600, fontFamily: "'Inter', sans-serif", textDecoration: 'none', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Get Started
          </motion.a>
          <motion.a
            href="#work"
            aria-label="Watch demo"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.93 }}
            style={{ width: '44px', height: '44px', borderRadius: '999px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
          </motion.a>
        </motion.div>
      </div>

      <div style={{ position: 'absolute', bottom: '34px', left: 'clamp(20px, 5vw, 64px)', zIndex: 10, display: 'flex', gap: '10px' }}>
        {socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            aria-label={s.label}
            target="_blank"
            rel="noreferrer"
            style={{ width: '34px', height: '34px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.75)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d={s.path} /></svg>
          </a>
        ))}
      </div>
    </section>
  )
}
```

## Design notes (context, not instructions to change anything)

- Layout is **not** centered. Content starts `24vh` from the top and `clamp(20px, 5vw, 64px)` from the left (64px on desktop).
- The navbar logo is a white line-art **car** icon, chosen to give Aurora product-specific branding.
- Overlay opacities are very light (`0.10`, `0.13`, `0.19`, `0.07`), so the background video should be bright and vivid.
- On screens under 768px the nav links are hidden; the logo and "Contact Us" pill stay.
