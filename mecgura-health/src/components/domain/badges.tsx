import { Badge, StatusBadge } from "@/components/ui";
import { CLINIC_TYPES, TENANT_STATUSES, USER_STATUSES, type ClinicType, type TenantStatus, type UserStatus } from "@/lib/domain/constants";
import { ROLE_LABELS, type RoleKey } from "@/lib/permissions/constants";

export function TenantStatusBadge({ status }: { status: string }) {
  const s = TENANT_STATUSES[status as TenantStatus] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
export function UserStatusBadge({ status }: { status: string }) {
  const s = USER_STATUSES[status as UserStatus] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
export const RoleBadge = ({ role }: { role: string }) => <Badge tone="primary">{ROLE_LABELS[role as RoleKey] ?? role}</Badge>;
export const clinicTypeLabel = (t: string) => CLINIC_TYPES[t as ClinicType] ?? t;
