import { PageHeader } from "@/components/ds";
import { SettingsNav } from "@/components/app/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your account, security and workspace." />
      <SettingsNav />
      <div className="max-w-3xl">{children}</div>
    </>
  );
}
