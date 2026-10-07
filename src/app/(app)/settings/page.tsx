import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { ProfileForm } from "@/components/app/settings/profile-form";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfileSettingsPage() {
  const { user } = await getAppContext();
  return <ProfileForm name={user.name ?? ""} email={user.email} />;
}
