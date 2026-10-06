/* eslint-disable @next/next/no-img-element -- tenant-uploaded images are served by our own /api/assets route */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClinicDetailActions } from "@/components/clinic/clinic-actions";
import { RoleBadge, TenantStatusBadge, UserStatusBadge, clinicTypeLabel } from "@/components/domain/badges";
import { Breadcrumb, ButtonLink, Card, CardBody, CardHeader, DataTable, StatusBadge, type Column } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getClinic } from "@/lib/services/clinics";
import { resolveBrandColors } from "@/theme/tokens";

export const metadata: Metadata = { title: "Clinic details" };
const fmt = (d?: Date | null) => (d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="type-caption">{label}</dt><dd className="type-body break-words">{children || "—"}</dd></div>;
}

export default async function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.manage");
  const { id } = await params;
  const t = await getClinic(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const brand = resolveBrandColors(t.branding);
  const rootDomain = getEnv().TENANT_ROOT_DOMAIN;
  type U = (typeof t.users)[number];
  const cols: Column<U>[] = [
    { key: "name", header: "Name", cell: (u) => u.name },
    { key: "role", header: "Role", cell: (u) => <RoleBadge role={u.role.key} /> },
    { key: "status", header: "Status", cell: (u) => <UserStatusBadge status={u.status} /> },
    { key: "last", header: "Last sign-in", cell: (u) => fmt(u.lastLoginAt), hideOnMobile: true },
  ];

  return (
    <div className="space-y-section">
      <div>
        <Breadcrumb items={[{ label: "Clinics", href: "/platform/clinics" }, { label: t.name }]} />
        <div className="flex flex-wrap items-center gap-3"><h1 className="type-page-title">{t.name}</h1><TenantStatusBadge status={t.status} />{t.isDemo && <StatusBadge tone="warning">Demo</StatusBadge>}</div>
      </div>
      <ClinicDetailActions id={t.id} name={t.name} status={t.status} />

      <div className="grid gap-section lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" action={<ButtonLink size="sm" variant="outline" href={`/platform/clinics/${t.id}/edit`}>Edit</ButtonLink>} />
          <CardBody><dl className="grid gap-3 sm:grid-cols-2">
            <Item label="Legal name">{t.legalName}</Item><Item label="Type">{clinicTypeLabel(t.clinicType)}</Item>
            <Item label="Email">{t.contactEmail}</Item><Item label="Phone">{t.contactPhone}</Item>
            <Item label="Address">{[t.address, t.city, t.state, t.pincode, t.country].filter(Boolean).join(", ")}</Item><Item label="Timezone">{t.timezone}</Item>
            <Item label="Workspace address">{t.slug}</Item><Item label="Plan">{t.subscription ? `${t.subscription.plan.name} (${t.subscription.status.toLowerCase()})` : null}</Item>
            <Item label="Created">{fmt(t.createdAt)}</Item><Item label="Updated">{fmt(t.updatedAt)}</Item>
          </dl></CardBody>
        </Card>
        <Card>
          <CardHeader title="Branding & domain" />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {(["primary", "secondary", "accent"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2"><span aria-hidden className="size-8 rounded-md border border-line" style={{ background: brand[k] }} /><div><p className="type-label capitalize">{k}</p><p className="type-caption font-mono">{brand[k]}</p></div></div>
              ))}
              <div className="flex items-center gap-2">{t.branding?.logoUrl ? <img src={t.branding.logoUrl} alt="Clinic logo" className="size-10 rounded-md border border-line object-contain" /> : <span className="type-caption">No logo uploaded</span>}</div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Item label="Subdomain">{t.subdomain ? (rootDomain ? `${t.subdomain}.${rootDomain}` : `${t.subdomain} (root domain not configured)`) : null}</Item>
              <Item label="Custom domain">{t.customDomain ? <>{t.customDomain} {t.customDomainVerifiedAt ? <StatusBadge tone="success">Verified</StatusBadge> : <StatusBadge tone="warning">Not verified</StatusBadge>}</> : null}</Item>
            </dl>
            <ButtonLink size="sm" variant="outline" href={`/platform/clinics/${t.id}/edit#domain`}>Manage domain</ButtonLink>
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`Users (${t.users.length})`} description="Account details only — no clinical data is shown here." />
        <DataTable caption="Clinic users" columns={cols} rows={t.users} rowKey={(u) => u.id} empty={{ title: "No users yet" }} />
      </Card>
    </div>
  );
}
