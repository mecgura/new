import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoleBadge, UserStatusBadge } from "@/components/domain/badges";
import { UserForm } from "@/components/team/user-form";
import type { UserFormValues } from "@/components/team/user-values";
import { UserActions } from "@/components/team/user-actions";
import { AvatarUploader } from "@/components/team/avatar-uploader";
import { Breadcrumb } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getUser } from "@/lib/services/users";

export const metadata: Metadata = { title: "Edit user" };

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPagePermission("users.edit");
  const { id } = await params;
  const u = await getUser(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const d = u.doctorProfile, s = u.staffProfile;
  const initial: UserFormValues = {
    name: u.name, email: u.email, phone: u.phone ?? "", role: u.role.key, grants: u.permissionGrants.map((g) => g.permission),
    qualification: d?.qualification ?? "", specialization: d?.specialization ?? "", registrationNumber: d?.registrationNumber ?? "",
    experienceYears: d?.experienceYears?.toString() ?? "", gender: d?.gender ?? "", bio: d?.bio ?? "", consultationFee: d?.consultationFee?.toString() ?? "",
    employeeRef: s?.employeeRef ?? "", designation: s?.designation ?? "",
  };
  return (
    <div className="space-y-section">
      <div>
        <Breadcrumb items={[{ label: "Team", href: "/team" }, { label: u.name }]} />
        <div className="flex flex-wrap items-center gap-3"><h1 className="type-page-title">{u.name}</h1><RoleBadge role={u.role.key} /><UserStatusBadge status={u.status} /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <AvatarUploader userId={u.id} name={u.name} url={u.avatarUrl} />
        <UserActions variant="buttons" id={u.id} name={u.name} status={u.status} isSelf={u.id === ctx.user.id} canEdit canDisable={ctx.permissions.has("users.disable")} canInvite={ctx.permissions.has("users.create")} />
      </div>
      <UserForm mode="edit" userId={u.id} initial={initial} isSelf={u.id === ctx.user.id} />
    </div>
  );
}
