import { AppShell } from "@/components/shell/app-shell";
import { ViewingAsBanner } from "@/components/clinic/viewing-as-banner";
import { AnnouncementBanner } from "@/components/shell/announcement-banner";
import { announcementsFor } from "@/lib/services/platform-admin";
import { requireContext } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { getVisibleNav } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const env = getEnv();
  const announcements = await announcementsFor(ctx).catch(() => []);
  const nav = getVisibleNav({
    permissions: ctx.permissions,
    enabledModules: ctx.enabledModules,
    // Unbuilt modules show as disabled "Soon" items only in development or when explicitly enabled.
    showPlanned: env.isDev || env.SHOW_PLANNED_MODULES,
  });
  return (
    <AppShell
      nav={nav}
      user={{ name: ctx.user.name, email: ctx.user.email, roleLabel: ROLE_LABELS[ctx.user.role], avatarUrl: ctx.user.avatarUrl }}
      workspace={ctx.tenant ? { name: ctx.tenant.name, isDemo: ctx.tenant.isDemo, logoUrl: ctx.tenant.logoUrl } : null}
    >
      {ctx.viewingAs && ctx.tenant && <ViewingAsBanner clinicName={ctx.tenant.name} reason={ctx.support?.reason ?? null} expiresAt={ctx.support?.expiresAt.toISOString() ?? null} />}
      <AnnouncementBanner items={announcements} />
      {children}
    </AppShell>
  );
}
