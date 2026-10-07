import {
  Bot,
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  GitBranch,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  ScrollText,
  Settings,
  Users,
  UsersRound,
  Workflow,
  Contact,
  Gauge,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  /** Omitted for modules that ship in a later phase — rendered disabled with a "Soon" badge. */
  href?: string;
  /** Match only the exact path (used for index routes). */
  exact?: boolean;
  /** Sub-paths owned by another nav item. */
  excludes?: string[];
  /** Extra path prefixes that also mark this item active. */
  also?: string[];
  /** Module ships in a later phase: rendered disabled with a "Soon" badge, never a fake page. */
  comingSoon?: boolean;
};

export type NavSection = { title?: string; items: NavItem[] };

/** Client workspace navigation. Live: Dashboard, Inbox, Contacts, WhatsApp (+ Quality Center), Campaigns, Templates, Automations, Team, Settings. */
export const CLIENT_NAV: NavSection[] = [
  {
    items: [
      { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", exact: true },
      { label: "Inbox", icon: Inbox, href: "/inbox" },
      { label: "Contacts", icon: Contact, href: "/contacts" },
      { label: "WhatsApp", icon: MessageCircle, href: "/dashboard/whatsapp", also: ["/whatsapp"] },
      { label: "Campaigns", icon: Megaphone, href: "/campaigns" },
      { label: "Templates", icon: FileText, href: "/templates" },
      { label: "Automations", icon: Workflow, href: "/automations" },
      { label: "Flows", icon: GitBranch, href: "/flows" },
      { label: "AI Agent", icon: Bot, href: "/ai" },
      { label: "Analytics", icon: BarChart3, href: "/analytics" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Team", icon: UsersRound, href: "/team" },
      { label: "API", icon: KeyRound, href: "/api" },
      { label: "Webhooks", icon: Webhook, href: "/webhooks" },
      { label: "Billing", icon: CreditCard, href: "/billing" },
      { label: "Settings", icon: Settings, href: "/settings" },
    ],
  },
];

/**
 * Super Admin navigation. Live: Dashboard, Clients, WhatsApp Accounts
 * (registry), Billing & Plans, Usage, Analytics, Logs & Audit, Settings.
 */
export const ADMIN_NAV: NavSection[] = [
  {
    title: "Platform",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, href: "/admin", exact: true },
      { label: "Clients", icon: Building2, href: "/admin/clients" },
      { label: "Users", icon: Users, href: "/admin/users" },
      { label: "WhatsApp Accounts", icon: MessageCircle, href: "/admin/whatsapp" },
      { label: "Billing & Plans", icon: CreditCard, href: "/admin/billing" },
      { label: "Usage", icon: Gauge, href: "/admin/usage" },
      { label: "Analytics", icon: BarChart3, href: "/admin/analytics" },
      { label: "Logs & Audit", icon: ScrollText, href: "/admin/audit-logs" },
      { label: "Settings", icon: Settings, href: "/admin/settings" },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (!item.href) return false;
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (item.excludes?.some(under)) return false;
  if (item.also?.some(under)) return true;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
