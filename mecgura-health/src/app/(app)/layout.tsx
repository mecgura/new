import { AppShell } from "@/components/shell/app-shell";
import { requireContext } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { getVisibleNav } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const env = getEnv();
  const nav = getVisibleNav({
    role: ctx.user.role,
    enabledModules: ctx.enabledModules,
    // Unbuilt modules show as disabled "Soon" items only in development or when explicitly enabled.
    showPlanned: env.isDev || env.SHOW_PLANNED_MODULES,
  });
  return (
    <AppShell
      nav={nav}
      user={{ name: ctx.user.name, email: ctx.user.email, roleLabel: ROLE_LABELS[ctx.user.role] }}
      workspace={ctx.tenant ? { name: ctx.tenant.name, isDemo: ctx.tenant.isDemo, logoUrl: ctx.tenant.logoUrl } : null}
    >
      {children}
    </AppShell>
  );
}
