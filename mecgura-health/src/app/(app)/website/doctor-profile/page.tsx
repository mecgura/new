import { redirect } from "next/navigation";
import { requireTenantPagePermission } from "@/lib/auth/context";

/** "My doctor profile": goes straight to the signed-in doctor's own public profile editor. */
export default async function MyDoctorProfile() {
  const ctx = await requireTenantPagePermission("website.profile");
  redirect(ctx.user.role === "DOCTOR" ? `/website/doctors/${ctx.user.id}` : "/website/doctors");
}
