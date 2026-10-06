import { BarChart3, Boxes, CalendarCheck, ClipboardList, FileText, Globe, HeartPulse, LayoutDashboard, MessageSquare, Pill, Receipt, Repeat, Settings, Stethoscope, TestTube2, Users, type LucideIcon } from "lucide-react";
import type { NavIcon } from "@/config/navigation";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  patients: Users,
  opd: HeartPulse,
  appointments: CalendarCheck,
  consultations: Stethoscope,
  prescriptions: Pill,
  tests: TestTube2,
  documents: FileText,
  tasks: ClipboardList,
  billing: Receipt,
  inventory: Boxes,
  followups: Repeat,
  communications: MessageSquare,
  analytics: BarChart3,
  website: Globe,
  settings: Settings,
};
