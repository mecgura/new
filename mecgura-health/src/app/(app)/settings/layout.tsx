import { SettingsTabs, type SettingsTab } from "@/components/shell/settings-tabs";
import { getContext } from "@/lib/auth/context";

const CLINIC_TABS: SettingsTab[] = [
  { href: "/settings", label: "Profile & workspace" },
  { href: "/settings/clinic", label: "Clinic profile" },
  { href: "/settings/branding", label: "Theme & branding" },
  { href: "/settings/scheduling", label: "Scheduling & OPD" },
  { href: "/settings/lab", label: "Laboratory" },
  { href: "/settings/followups", label: "Follow-ups" },
  { href: "/settings/portal", label: "Patient portal" },
  { href: "/settings/communications", label: "Communications" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/privacy", label: "Privacy & consent" },
];

// A platform administrator is not attached to a clinic, so the clinic tabs would only bounce them away.
// They get the platform equivalents instead.
const PLATFORM_TABS: SettingsTab[] = [
  { href: "/settings", label: "Profile" },
  { href: "/platform/settings", label: "Platform settings" },
  { href: "/platform/security", label: "Security & privacy" },
  { href: "/platform/communications", label: "Communications" },
  { href: "/platform/notifications", label: "Notifications" },
  { href: "/account/security", label: "My account security" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const tabs = ctx && !ctx.tenant ? PLATFORM_TABS : CLINIC_TABS;
  return (
    <div className="space-y-section">
      <h1 className="type-page-title">Settings</h1>
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
