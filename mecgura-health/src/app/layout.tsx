import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
  const ctx = await getContext();
  const brand = ctx?.tenant?.brand ?? (ctx ? undefined : (await resolvePublicTenant())?.brand) ?? resolveBrandColors();
  return (
    <html lang="en" className={inter.variable} style={brandToCssVars(brand) as React.CSSProperties}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
