import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { ToastProvider } from "@/components/ui";
import { getContext } from "@/lib/auth/context";
import { resolvePublicTenant } from "@/lib/tenant/resolve";
import { buildMetadata } from "@/lib/seo";
import { brandToCssVars, resolveBrandColors } from "@/theme/tokens";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Internal staff application: keep it out of search engines. Public doctor websites will use buildMetadata() without noIndex.
export const metadata: Metadata = {
  ...buildMetadata({ title: "MECGURA HEALTH", description: "Doctor & clinic operating system", noIndex: true }),
  title: { default: "MECGURA HEALTH", template: "%s · MECGURA HEALTH" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#14529e" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // White-label: signed-in users get their clinic's colours; logged-out pages use the host's tenant (custom domain/subdomain).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const ctx = await getContext();
  const brand = ctx?.tenant?.brand ?? (ctx ? undefined : (await resolvePublicTenant())?.brand) ?? resolveBrandColors();
  return (
    <html lang="en" className={inter.variable} style={brandToCssVars(brand) as React.CSSProperties}>
      <body>
        {/* TEMP-DEBUG: shows client errors on screen. Remove after the blank-page issue is solved. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){function show(m){try{var d=document.getElementById("__dbg");if(!d){d=document.createElement("pre");d.id="__dbg";d.style.cssText="position:fixed;z-index:99999;left:0;right:0;top:0;max-height:70vh;overflow:auto;margin:0;padding:12px;background:#300;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap";document.documentElement.appendChild(d)}d.textContent+=m+"\\n\\n"}catch(e){}}
window.addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){show("LOAD FAIL: "+(t.src||t.href))}else{show("ERROR: "+e.message+" @ "+e.filename+":"+e.lineno+"\\n"+(e.error&&e.error.stack||""))}},true);
window.addEventListener("unhandledrejection",function(e){show("REJECTION: "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason))});
setTimeout(function(){if(!document.getElementById("main")){show("BLANK: #main missing after 5s. UA="+navigator.userAgent+" body="+document.body.innerHTML.slice(0,300))}},5000)})();`,
          }}
        />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
