import type { Metadata } from "next";
import { ProfileView } from "@/components/portal/profile-view";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getProfile, listMyRequests } from "@/lib/services/portal-account";

export const metadata: Metadata = { title: "My profile" };
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const ctx = await requirePatientContext(); const [profile, reqs] = await Promise.all([getProfile(ctx), listMyRequests(ctx)]);
  return <div><PageTitle title="My profile" /><ProfileView profile={profile} requests={reqs.rows} /></div>;
}
