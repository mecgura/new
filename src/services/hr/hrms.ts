import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { normalizePhone } from "@/services/inbox/contacts";

/**
 * HRMS: the client's staff list, daily attendance and leave requests, with a monthly attendance report (CSV) for
 * payroll. Dates are India calendar days ("YYYY-MM-DD"). Approved leave marks the days as "leave" automatically.
 */
export const ATTENDANCE = ["present", "absent", "half_day", "leave", "holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE)[number];
export const LEAVE_TYPES = ["casual", "sick", "paid", "unpaid"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").or(z.literal(""));

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(100),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || Boolean(normalizePhone(v)), "Enter a valid mobile number")
    .transform((v) => (v ? normalizePhone(v)! : ""))
    .default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).or(z.literal("")).default(""),
  designation: z.string().trim().max(80).default(""),
  department: z.string().trim().max(80).default(""),
  joinDate: isoDate.or(z.literal("")).default(""),
  salaryRupees: z.coerce.number().min(0).max(10_000_000).default(0),
  status: z.enum(["active", "exited"]).default("active"),
});

export const markSchema = z.object({
  date: isoDate,
  entries: z
    .array(z.object({ employeeId: z.string().min(1).max(64), status: z.enum(ATTENDANCE), checkIn: hhmm.default(""), checkOut: hhmm.default(""), note: z.string().trim().max(200).default("") }))
    .min(1)
    .max(500),
});

export const leaveSchema = z
  .object({ employeeId: z.string().min(1).max(64), from: isoDate, to: isoDate, type: z.enum(LEAVE_TYPES).default("casual"), reason: z.string().trim().max(500).default("") })
  .refine((v) => v.from <= v.to, { message: "End date must be on or after the start date", path: ["to"] });

export const decideSchema = z.object({ status: z.enum(["approved", "rejected"]) });

const enabled = (orgId: string) => assertServiceEnabled(orgId, "HRMS");
const IST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
export const todayIST = () => IST.format(new Date());

function days(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 366) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const empDto = (e: Awaited<ReturnType<typeof db.employee.findFirstOrThrow>>) => ({ ...e, salaryRupees: e.salaryPaise / 100 });

export async function listEmployees(access: OrgAccess) {
  await enabled(access.organizationId);
  const rows = await db.employee.findMany({ where: { organizationId: access.organizationId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  return rows.map(empDto);
}

async function loadEmployee(organizationId: string, id: string) {
  const e = await db.employee.findFirst({ where: { id, organizationId } });
  if (!e) throw new ApiError("NOT_FOUND", "Employee not found.");
  return e;
}

export async function saveEmployee(access: OrgAccess, id: string | null, input: z.infer<typeof employeeSchema>, req?: Request) {
  await enabled(access.organizationId);
  if (id) await loadEmployee(access.organizationId, id);
  else if ((await db.employee.count({ where: { organizationId: access.organizationId } })) >= 1000) throw new ApiError("CONFLICT", "Up to 1,000 employees per workspace.");
  const { salaryRupees, ...rest } = input;
  const data = { ...rest, salaryPaise: Math.round(salaryRupees * 100) };
  const e = id ? await db.employee.update({ where: { id }, data }) : await db.employee.create({ data: { ...data, organizationId: access.organizationId } });
  await audit({ action: "hr.employee_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "employee", targetId: e.id, metadata: { status: e.status }, req });
  return empDto(e);
}

export async function deleteEmployee(access: OrgAccess, id: string, req?: Request) {
  await enabled(access.organizationId);
  await loadEmployee(access.organizationId, id);
  await db.employee.delete({ where: { id } });
  await audit({ action: "hr.employee_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "employee", targetId: id, metadata: { deleted: true }, req });
}

/** One day's register: every active employee with their mark (if any). */
export async function dayAttendance(access: OrgAccess, date: string) {
  await enabled(access.organizationId);
  const [employees, marks] = await Promise.all([
    db.employee.findMany({ where: { organizationId: access.organizationId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    db.attendance.findMany({ where: { organizationId: access.organizationId, date } }),
  ]);
  return employees.map((e) => {
    const m = marks.find((x) => x.employeeId === e.id);
    return { ...e, status: (m?.status ?? "") as AttendanceStatus | "", checkIn: m?.checkIn ?? "", checkOut: m?.checkOut ?? "", note: m?.note ?? "" };
  });
}

export async function markAttendance(access: OrgAccess, input: z.infer<typeof markSchema>, req?: Request) {
  await enabled(access.organizationId);
  if (input.date > todayIST()) throw new ApiError("VALIDATION_ERROR", "You can't mark attendance for a future date.");
  const ids = [...new Set(input.entries.map((e) => e.employeeId))];
  const owned = await db.employee.count({ where: { organizationId: access.organizationId, id: { in: ids } } });
  if (owned !== ids.length) throw new ApiError("NOT_FOUND", "Employee not found.");
  await db.$transaction(
    input.entries.map((e) =>
      db.attendance.upsert({
        where: { employeeId_date: { employeeId: e.employeeId, date: input.date } },
        update: { status: e.status, checkIn: e.checkIn, checkOut: e.checkOut, note: e.note, markedById: access.user.id },
        create: { organizationId: access.organizationId, employeeId: e.employeeId, date: input.date, status: e.status, checkIn: e.checkIn, checkOut: e.checkOut, note: e.note, markedById: access.user.id },
      })
    )
  );
  await audit({ action: "hr.attendance_marked", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "attendance", targetId: input.date, metadata: { count: input.entries.length }, req });
  return dayAttendance(access, input.date);
}

/** Month summary per employee (present counts half days as 0.5) and a CSV for payroll. */
export async function monthReport(access: OrgAccess, month: string) {
  await enabled(access.organizationId);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError("VALIDATION_ERROR", "Pick a month.");
  const [employees, marks] = await Promise.all([
    db.employee.findMany({ where: { organizationId: access.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, salaryPaise: true, status: true } }),
    db.attendance.findMany({ where: { organizationId: access.organizationId, date: { startsWith: `${month}-` } }, select: { employeeId: true, status: true } }),
  ]);
  const rows = employees
    .map((e) => {
      const m = marks.filter((x) => x.employeeId === e.id);
      const n = (s: string) => m.filter((x) => x.status === s).length;
      return { id: e.id, name: e.name, designation: e.designation, status: e.status, present: n("present") + n("half_day") * 0.5, halfDays: n("half_day"), absent: n("absent"), leave: n("leave"), holiday: n("holiday"), marked: m.length, salaryRupees: e.salaryPaise / 100 };
    })
    .filter((r) => r.status === "active" || r.marked > 0);
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [["Name", "Designation", "Present days", "Half days", "Absent", "Leave", "Holiday", "Days marked", "Monthly salary (Rs)"], ...rows.map((r) => [r.name, r.designation, r.present, r.halfDays, r.absent, r.leave, r.holiday, r.marked, r.salaryRupees])]
    .map((line) => line.map(cell).join(","))
    .join("\n");
  return { month, rows, csv };
}

export async function listLeave(access: OrgAccess) {
  await enabled(access.organizationId);
  return db.leaveRequest.findMany({
    where: { organizationId: access.organizationId },
    orderBy: [{ status: "asc" }, { from: "desc" }],
    take: 300,
    include: { employee: { select: { name: true } } },
  });
}

export async function addLeave(access: OrgAccess, input: z.infer<typeof leaveSchema>, req?: Request) {
  await enabled(access.organizationId);
  await loadEmployee(access.organizationId, input.employeeId);
  if (days(input.from, input.to).length > 90) throw new ApiError("VALIDATION_ERROR", "Leave can be up to 90 days at a time.");
  const l = await db.leaveRequest.create({ data: { ...input, organizationId: access.organizationId } });
  await audit({ action: "hr.leave_decided", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "leave", targetId: l.id, metadata: { status: "pending" }, req });
  return l;
}

/** Approve or reject. Approving marks every day of the leave as "leave" in attendance. */
export async function decideLeave(access: OrgAccess, id: string, status: "approved" | "rejected", req?: Request) {
  await enabled(access.organizationId);
  const l = await db.leaveRequest.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!l) throw new ApiError("NOT_FOUND", "Leave request not found.");
  const u = await db.leaveRequest.update({ where: { id }, data: { status, decidedById: access.user.id, decidedAt: new Date() } });
  if (status === "approved") {
    await db.$transaction(
      days(l.from, l.to).map((date) =>
        db.attendance.upsert({
          where: { employeeId_date: { employeeId: l.employeeId, date } },
          update: { status: "leave", note: `${l.type} leave`, markedById: access.user.id },
          create: { organizationId: access.organizationId, employeeId: l.employeeId, date, status: "leave", note: `${l.type} leave`, markedById: access.user.id },
        })
      )
    );
  } else if (l.status === "approved") {
    await db.attendance.deleteMany({ where: { employeeId: l.employeeId, date: { in: days(l.from, l.to) }, status: "leave" } });
  }
  await audit({ action: "hr.leave_decided", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "leave", targetId: id, metadata: { status }, req });
  return u;
}
