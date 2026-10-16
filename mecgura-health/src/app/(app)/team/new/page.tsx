import type { Metadata } from "next";
import { Breadcrumb } from "@/components/ui";
import { UserForm } from "@/components/team/user-form";
import { EMPTY_USER } from "@/components/team/user-values";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requireTenantPagePermission("users.create");
  return (
    <div className="space-y-section">
      <div><Breadcrumb items={[{ label: "Team", href: "/team" }, { label: "Add user" }]} /><h1 className="type-page-title">Add user</h1></div>
      <UserForm mode="create" initial={EMPTY_USER} />
    </div>
  );
}
