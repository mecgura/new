import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarClock, CalendarDays, CheckCircle2, Hourglass, Layers, MailPlus, ShieldCheck, Stethoscope, UserRound, UsersRound } from "lucide-react";
import { SetupChecklist } from "@/components/clinic/setup-checklist";
import { TenantStatusBadge, clinicTypeLabel } from "@/components/domain/badges";
import { Alert, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { requirePagePermission, type TenantRequestContext } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/permissions";
import { clinicOverview } from "@/lib/services/overview";
import { opdStats } from "@/lib/services/opd";
import { formatInTz } from "@/lib/scheduling/time";
import { platformStats } from "@/lib/services/clinics";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-card">
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="size-5" /></span>
      <div className="min-w-0"><p className="type-caption">{label}</p><p className="type-card-title truncate">{value}</p></div>
    </Card>
  );
}

export default async function DashboardPage() {
  const ctx = await requirePagePermission("dashboard.view");
  const firstName = ctx.user.name.split(" ")[0];

  // Super Admin outside any clinic: platform overview.
  if (!ctx.tenant) {
    const s = await platformStats(ctx);
    return (
      <div className="space-y-section">
        <div><h1 className="type-page-title">Welcome, {firstName}</h1><p className="type-secondary mt-1">MECGURA HEALTH platform overview.</p></div>
        <section aria-label="Platform summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
          <Stat icon={Building2} label="Clinics" value={s.totalClinics} />
          <Stat icon={ShieldCheck} label="Active" value={s.counts.ACTIVE ?? 0} />
          <Stat icon={Layers} label="Trial" value={s.counts.TRIAL ?? 0} />
          <Stat icon={UsersRound} label="Clinic users" value={s.users} />
        </section>
        {(s.counts.SUSPENDED ?? 0) + (s.counts.INACTIVE ?? 0) > 0 && <Alert tone="warning" title="Clinics with restricted access">{s.counts.SUSPENDED ?? 0} suspended, {s.counts.INACTIVE ?? 0} inactive.</Alert>}
        <Card><CardHeader title="Clinics" description="Create and manage clinics." action={<ButtonLink href="/platform/clinics">Open clinics</ButtonLink>} /></Card>
      </div>
    );
  }

  const tctx = { ...ctx, tenant: ctx.tenant, tenantId: ctx.tenant.id } as TenantRequestContext;
  const o = await clinicOverview(tctx);
  const t = ctx.tenant;
  const showSched = ctx.permissions.has("appointments.view") || ctx.permissions.has("opd.view");
  const sched = showSched ? await opdStats(tctx) : null;
  return (
    <div className="space-y-section">
      <div>
        <h1 className="type-page-title">Welcome, {firstName}</h1>
        <p className="type-secondary mt-1">{t.name} · {clinicTypeLabel(t.clinicType)}</p>
      </div>

      <section aria-label="Clinic overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
        <Stat icon={Stethoscope} label="Doctors" value={o.doctors} />
        <Stat icon={UsersRound} label="Staff" value={o.staff} />
        <Stat icon={MailPlus} label="Pending invitations" value={o.invited} />
        <Stat icon={UserRound} label="You" value={ROLE_LABELS[ctx.user.role]} />
      </section>

      {sched && (
        <section aria-label="Today at the clinic" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-section">Today</h2>
            <div className="flex gap-3">
              {ctx.permissions.has("appointments.view") && <Link href="/appointments" className="type-label">Appointments →</Link>}
              {ctx.permissions.has("opd.view") && <Link href="/opd" className="type-label">Live OPD →</Link>}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
            <Stat icon={CalendarDays} label="Appointments today" value={sched.appointmentsToday} />
            <Stat icon={Hourglass} label="Waiting in queue" value={sched.waiting} />
            <Stat icon={Stethoscope} label="With the doctor" value={sched.inConsultation} />
            <Stat icon={CheckCircle2} label="Completed" value={sched.completed} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
            <Stat icon={CalendarClock} label="Next appointment" value={sched.nextAppointmentAt ? formatInTz(new Date(sched.nextAppointmentAt), sched.tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "None booked"} />
            <Stat icon={MailPlus} label="Waiting for confirmation" value={sched.requested} />
            <Stat icon={UserRound} label="No-shows today" value={sched.noShows} />
            <Stat icon={CalendarDays} label="Cancelled today" value={sched.cancelled} />
          </div>
        </section>
      )}

      <div className="grid gap-section lg:grid-cols-3">
        <div className="lg:col-span-2"><SetupChecklist items={o.checklist} later={o.later} /></div>
        <Card>
          <CardHeader title="Plan & status" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between gap-2"><span className="type-secondary">Clinic status</span><TenantStatusBadge status={t.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="type-secondary">Plan</span><span className="type-label">{t.planName ?? "—"}</span></div>
            <p className="type-caption">Subscription, billing and trial limits arrive in a later phase.</p>
            {ctx.permissions.has("users.view") && <Link href="/team" className="type-label">Manage team →</Link>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
