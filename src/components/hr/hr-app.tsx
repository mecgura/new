"use client";

import * as React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingState, Modal, PageHeader, Select, TabPanel, Tabs, Table, TBody, TD, TH, THead, TR, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

type Status = "present" | "absent" | "half_day" | "leave" | "holiday";
type Row = { id: string; name: string; designation: string; status: Status | ""; checkIn: string; checkOut: string; note: string };
type Employee = { id: string; name: string; phone: string; email: string; designation: string; department: string; joinDate: string; salaryRupees: number; status: "active" | "exited" };
type Leave = { id: string; employeeId: string; from: string; to: string; type: string; reason: string; status: "pending" | "approved" | "rejected"; employee: { name: string } };
type ReportRow = { id: string; name: string; designation: string; present: number; halfDays: number; absent: number; leave: number; holiday: number; marked: number; salaryRupees: number };

const STATUS: { v: Status; label: string; short: string; cls: string }[] = [
  { v: "present", label: "Present", short: "P", cls: "bg-emerald-500 text-white" },
  { v: "half_day", label: "Half day", short: "½", cls: "bg-amber-500 text-white" },
  { v: "absent", label: "Absent", short: "A", cls: "bg-red-500 text-white" },
  { v: "leave", label: "Leave", short: "L", cls: "bg-sky-500 text-white" },
  { v: "holiday", label: "Holiday", short: "H", cls: "bg-violet-500 text-white" },
];
const LEAVE_LABEL: Record<string, string> = { casual: "Casual", sick: "Sick", paid: "Paid", unpaid: "Unpaid" };
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const nice = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const TABS = [
  { id: "attendance", label: "Attendance" },
  { id: "employees", label: "Employees" },
  { id: "leave", label: "Leave" },
  { id: "report", label: "Monthly report" },
];

/** HRMS: daily attendance register, staff list, leave requests and a monthly report for payroll. */
export function HrApp({ orgId }: { orgId: string }) {
  const [tab, setTab] = React.useState("attendance");
  const base = `/api/organizations/${orgId}/hr`;
  return (
    <>
      <PageHeader title="HR & Attendance" description="Mark daily attendance, manage staff and leave, and download the monthly report for salaries." />
      <Tabs label="HR sections" items={TABS} value={tab} onValueChange={setTab} />
      <TabPanel id="attendance" active={tab === "attendance"}>{tab === "attendance" ? <AttendanceTab base={base} onNoStaff={() => setTab("employees")} /> : null}</TabPanel>
      <TabPanel id="employees" active={tab === "employees"}>{tab === "employees" ? <EmployeesTab base={base} /> : null}</TabPanel>
      <TabPanel id="leave" active={tab === "leave"}>{tab === "leave" ? <LeaveTab base={base} /> : null}</TabPanel>
      <TabPanel id="report" active={tab === "report"}>{tab === "report" ? <ReportTab base={base} /> : null}</TabPanel>
    </>
  );
}

function AttendanceTab({ base, onNoStaff }: { base: string; onNoStaff: () => void }) {
  const toast = useToast();
  const [date, setDate] = React.useState<string | null>(null);
  const [today, setToday] = React.useState("");
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (d: string | null) => {
    const r = await apiFetch<{ date: string; today: string; rows: Row[] }>(`${base}/attendance${d ? `?date=${d}` : ""}`);
    if (!r.ok) return toast(r.error, "error");
    setDate(r.data.date);
    setToday(r.data.today);
    setRows(r.data.rows);
    setDirty(false);
  }, [base, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const set = (id: string, patch: Partial<Row>) => {
    setDirty(true);
    setRows((xs) => xs?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? null);
  };

  async function save() {
    if (!rows || !date) return;
    const entries = rows.filter((r) => r.status).map((r) => ({ employeeId: r.id, status: r.status as Status, checkIn: r.checkIn, checkOut: r.checkOut, note: r.note }));
    if (!entries.length) return toast("Mark at least one person.", "error");
    setBusy(true);
    const r = await apiFetch<{ rows: Row[] }>(`${base}/attendance`, { method: "PUT", body: { date, entries } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setRows(r.data.rows);
    setDirty(false);
    toast("Attendance saved");
  }

  if (!rows || !date) return <LoadingState />;
  if (!rows.length) return <Card><EmptyState icon={UsersRound} title="Add your staff first" description="Add employees, then mark their attendance here every day." action={<Button onClick={onNoStaff}>Add employees</Button>} /></Card>;
  const counts = Object.fromEntries(STATUS.map((s) => [s.v, rows.filter((r) => r.status === s.v).length]));
  return (
    <Card>
      <CardHeader
        title={nice(date)}
        description={`${counts.present} present · ${counts.half_day} half day · ${counts.absent} absent · ${counts.leave} on leave · ${rows.filter((r) => !r.status).length} not marked`}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => void load(shift(date, -1))}><ChevronLeft /></Button>
            <Input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && void load(e.target.value)} className="h-8 w-40" />
            <Button size="sm" variant="ghost" aria-label="Next day" disabled={date >= today} onClick={() => void load(shift(date, 1))}><ChevronRight /></Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setDirty(true); setRows((xs) => xs?.map((x) => (x.status ? x : { ...x, status: "present" })) ?? null); }}>
            <CalendarCheck /> Mark everyone else present
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setDirty(true); setRows((xs) => xs?.map((x) => ({ ...x, status: "holiday" })) ?? null); }}>Holiday for all</Button>
        </div>
        <ul className="divide-y divide-app-border rounded-xl border border-app-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-[10rem] flex-1">
                <p className="font-medium text-app-text">{r.name}</p>
                <p className="text-caption text-app-subtle">{r.designation || "—"}</p>
              </div>
              <div className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${r.name}`}>
                {STATUS.map((s) => (
                  <button key={s.v} type="button" role="radio" aria-checked={r.status === s.v} title={s.label} aria-label={s.label} onClick={() => set(r.id, { status: s.v })}
                    className={`grid size-9 place-items-center rounded-lg text-small font-bold transition ${r.status === s.v ? s.cls : "border border-app-border text-app-muted hover:bg-app-hover"}`}>
                    {s.short}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Input type="time" aria-label={`${r.name} in`} value={r.checkIn} onChange={(e) => set(r.id, { checkIn: e.target.value })} className="h-9 w-28" />
                <Input type="time" aria-label={`${r.name} out`} value={r.checkOut} onChange={(e) => set(r.id, { checkOut: e.target.value })} className="h-9 w-28" />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Button loading={busy} disabled={!dirty} onClick={() => void save()}>Save attendance</Button>
          {dirty ? <span className="text-caption text-amber-300">Unsaved changes</span> : null}
          <span className="text-caption text-app-subtle">P present · ½ half day · A absent · L leave · H holiday. In/out times are optional.</span>
        </div>
      </CardBody>
    </Card>
  );
}

function EmployeesTab({ base }: { base: string }) {
  const toast = useToast();
  const [list, setList] = React.useState<Employee[] | null>(null);
  const [edit, setEdit] = React.useState<Employee | "new" | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ employees: Employee[] }>(`${base}/employees`);
    if (!r.ok) return toast(r.error, "error");
    setList(r.data.employees);
  }, [base, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (!list) return <LoadingState />;
  return (
    <Card>
      <CardHeader title={`${list.filter((e) => e.status === "active").length} active employees`} action={<Button size="sm" onClick={() => setEdit("new")}><Plus /> Add employee</Button>} />
      {list.length ? (
        <Table>
          <THead><TR><TH>Name</TH><TH>Designation</TH><TH>Mobile</TH><TH>Joined</TH><TH>Salary / month</TH><TH>Status</TH><TH><span className="sr-only">Edit</span></TH></TR></THead>
          <TBody>
            {list.map((e) => (
              <TR key={e.id}>
                <TD className="font-medium">{e.name}</TD>
                <TD>{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</TD>
                <TD>{e.phone || "—"}</TD>
                <TD>{e.joinDate || "—"}</TD>
                <TD>{e.salaryRupees ? formatINR(Math.round(e.salaryRupees * 100)) : "—"}</TD>
                <TD>{e.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Exited</Badge>}</TD>
                <TD><Button size="sm" variant="ghost" aria-label={`Edit ${e.name}`} onClick={() => setEdit(e)}><Pencil /></Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState icon={UsersRound} title="No employees yet" description="Add your staff to start marking attendance." action={<Button onClick={() => setEdit("new")}><Plus /> Add employee</Button>} />
      )}
      {edit ? <EmployeeModal base={base} employee={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} /> : null}
    </Card>
  );
}

function EmployeeModal({ base, employee, onClose, onSaved }: { base: string; employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ name: employee?.name ?? "", phone: employee?.phone ?? "", email: employee?.email ?? "", designation: employee?.designation ?? "", department: employee?.department ?? "", joinDate: employee?.joinDate ?? "", salaryRupees: String(employee?.salaryRupees ?? ""), status: employee?.status ?? "active" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    const r = await apiFetch(employee ? `${base}/employees/${employee.id}` : `${base}/employees`, { method: employee ? "PUT" : "POST", body: { ...f, salaryRupees: Number(f.salaryRupees || 0) } });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    onSaved();
  }
  async function remove() {
    if (!employee || !window.confirm(`Delete ${employee.name} and their attendance history? To keep history, set status to Exited instead.`)) return;
    const r = await apiFetch(`${base}/employees/${employee.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title={employee ? "Edit employee" : "Add employee"}
      footer={<div className="flex w-full justify-between gap-2">{employee ? <Button variant="ghost" onClick={() => void remove()}><Trash2 /> Delete</Button> : <span />}<Button loading={busy} onClick={() => void save()}>Save</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="e-name" label="Name" error={errors.name}><Input value={f.name} onChange={set("name")} /></Field>
        <Field id="e-phone" label="Mobile" error={errors.phone}><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field id="e-email" label="Email" error={errors.email}><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field id="e-desig" label="Designation"><Input value={f.designation} onChange={set("designation")} placeholder="Sales executive" /></Field>
        <Field id="e-dept" label="Department"><Input value={f.department} onChange={set("department")} /></Field>
        <Field id="e-join" label="Joining date" error={errors.joinDate}><Input type="date" value={f.joinDate} onChange={set("joinDate")} /></Field>
        <Field id="e-sal" label="Monthly salary (₹)" error={errors.salaryRupees}><Input inputMode="numeric" value={f.salaryRupees} onChange={set("salaryRupees")} /></Field>
        <Field id="e-status" label="Status"><Select value={f.status} onChange={set("status")}><option value="active">Active</option><option value="exited">Exited</option></Select></Field>
      </div>
    </Modal>
  );
}

function LeaveTab({ base }: { base: string }) {
  const toast = useToast();
  const [list, setList] = React.useState<Leave[] | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [open, setOpen] = React.useState(false);
  const load = React.useCallback(async () => {
    const [l, e] = await Promise.all([apiFetch<{ leave: Leave[] }>(`${base}/leave`), apiFetch<{ employees: Employee[] }>(`${base}/employees`)]);
    if (!l.ok) return toast(l.error, "error");
    setList(l.data.leave);
    if (e.ok) setEmployees(e.data.employees.filter((x) => x.status === "active"));
  }, [base, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function decide(l: Leave, status: "approved" | "rejected") {
    const r = await apiFetch(`${base}/leave/${l.id}`, { method: "PATCH", body: { status } });
    if (!r.ok) return toast(r.error, "error");
    toast(status === "approved" ? "Approved. Those days are marked as leave." : "Rejected");
    void load();
  }

  if (!list) return <LoadingState />;
  return (
    <Card>
      <CardHeader title="Leave requests" description={`${list.filter((l) => l.status === "pending").length} waiting for a decision`} action={<Button size="sm" disabled={!employees.length} onClick={() => setOpen(true)}><Plus /> Add leave</Button>} />
      {list.length ? (
        <Table>
          <THead><TR><TH>Employee</TH><TH>Dates</TH><TH>Type</TH><TH>Reason</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
          <TBody>
            {list.map((l) => (
              <TR key={l.id}>
                <TD className="font-medium">{l.employee.name}</TD>
                <TD>{l.from === l.to ? l.from : `${l.from} → ${l.to}`}</TD>
                <TD>{LEAVE_LABEL[l.type] ?? l.type}</TD>
                <TD className="max-w-[16rem] truncate">{l.reason || "—"}</TD>
                <TD><Badge tone={l.status === "approved" ? "success" : l.status === "rejected" ? "danger" : "warning"}>{l.status}</Badge></TD>
                <TD>
                  <div className="flex gap-1">
                    {l.status !== "approved" ? <Button size="sm" variant="secondary" onClick={() => void decide(l, "approved")}>Approve</Button> : null}
                    {l.status !== "rejected" ? <Button size="sm" variant="ghost" onClick={() => void decide(l, "rejected")}>Reject</Button> : null}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <CardBody><p className="text-small text-app-muted">No leave requests yet.</p></CardBody>
      )}
      {open ? <LeaveModal base={base} employees={employees} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void load(); }} /> : null}
    </Card>
  );
}

function LeaveModal({ base, employees, onClose, onSaved }: { base: string; employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = React.useState({ employeeId: employees[0]?.id ?? "", from: "", to: "", type: "casual", reason: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    const r = await apiFetch(`${base}/leave`, { method: "POST", body: { ...f, to: f.to || f.from } });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
      return toast(r.error, "error");
    }
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Add leave request" footer={<Button loading={busy} onClick={() => void save()}>Add</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="l-emp" label="Employee" className="sm:col-span-2"><Select value={f.employeeId} onChange={set("employeeId")}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        <Field id="l-from" label="From" error={errors.from}><Input type="date" value={f.from} onChange={set("from")} /></Field>
        <Field id="l-to" label="To" error={errors.to} hint="Leave empty for one day"><Input type="date" value={f.to} onChange={set("to")} /></Field>
        <Field id="l-type" label="Type"><Select value={f.type} onChange={set("type")}>{Object.entries(LEAVE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field id="l-reason" label="Reason" className="sm:col-span-2"><Textarea rows={3} value={f.reason} onChange={set("reason")} /></Field>
      </div>
    </Modal>
  );
}

function ReportTab({ base }: { base: string }) {
  const toast = useToast();
  const [month, setMonth] = React.useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()));
  const [rows, setRows] = React.useState<ReportRow[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    void apiFetch<{ rows: ReportRow[] }>(`${base}/report?month=${month}`).then((r) => {
      if (!alive) return;
      if (!r.ok) return toast(r.error, "error");
      setRows(r.data.rows);
    });
    return () => {
      alive = false;
    };
  }, [base, month, toast]);
  return (
    <Card>
      <CardHeader
        title="Monthly attendance"
        description="Present counts half days as ½. Download it for salary calculation."
        action={
          <div className="flex flex-wrap gap-2">
            <Input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-8 w-40" />
            <a href={`${base}/report?month=${month}&format=csv`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-app-border px-3 text-small text-app-text hover:bg-app-hover"><Download className="size-4" aria-hidden="true" /> Download CSV</a>
          </div>
        }
      />
      {!rows ? <LoadingState /> : rows.length ? (
        <Table>
          <THead><TR><TH>Employee</TH><TH>Present</TH><TH>Absent</TH><TH>Leave</TH><TH>Holiday</TH><TH>Days marked</TH><TH>Salary / month</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}<span className="block text-caption text-app-subtle">{r.designation}</span></TD>
                <TD>{r.present}{r.halfDays ? <span className="text-caption text-app-subtle"> ({r.halfDays} half)</span> : null}</TD>
                <TD>{r.absent}</TD>
                <TD>{r.leave}</TD>
                <TD>{r.holiday}</TD>
                <TD>{r.marked}</TD>
                <TD>{r.salaryRupees ? formatINR(Math.round(r.salaryRupees * 100)) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <CardBody><p className="text-small text-app-muted">No attendance for this month yet.</p></CardBody>}
    </Card>
  );
}
