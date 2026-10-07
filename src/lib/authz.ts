// Role + permission model. Pure module (no DB / Node APIs) so it can be
// imported from the proxy, server code, client components and tests alike.

export const PLATFORM_ROLES = ["SUPER_ADMIN", "USER"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORG_ROLES = ["CLIENT_OWNER", "MANAGER", "AGENT"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  CLIENT_OWNER: "Owner",
  MANAGER: "Manager",
  AGENT: "Agent",
};

/** Accepts legacy values ("admin" from the pre-tenancy schema) and unknowns. */
export function normalizePlatformRole(role: string | null | undefined): PlatformRole {
  return role === "SUPER_ADMIN" || role === "admin" ? "SUPER_ADMIN" : "USER";
}

export function isSuperAdmin(role: string | null | undefined): boolean {
  return normalizePlatformRole(role) === "SUPER_ADMIN";
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Organization-scoped permissions. Add new keys here as modules ship
 * (e.g. "whatsapp:send", "campaigns:manage") — routes only ever check a
 * permission key, never a role name, so granular custom roles can be layered
 * on later without touching the routes.
 */
export const ORG_PERMISSIONS = {
  "org:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "org:update": ["CLIENT_OWNER"],
  "members:read": ["CLIENT_OWNER", "MANAGER"],
  "members:manage": ["CLIENT_OWNER"],
  "audit:read": ["CLIENT_OWNER", "MANAGER"],
  "dashboard:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "whatsapp:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "whatsapp:manage": ["CLIENT_OWNER"],
  // Inbox. Agents only see conversations assigned to them or unassigned.
  "inbox:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "inbox:view_all": ["CLIENT_OWNER", "MANAGER"],
  "inbox:reply": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "inbox:note": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "inbox:assign": ["CLIENT_OWNER", "MANAGER"], // assign / reassign anyone
  "inbox:claim": ["CLIENT_OWNER", "MANAGER", "AGENT"], // take an unassigned chat
  "inbox:transfer": ["CLIENT_OWNER", "MANAGER", "AGENT"], // hand over a chat you hold
  // Contacts / CRM
  "contacts:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "contacts:write": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "contacts:delete": ["CLIENT_OWNER", "MANAGER"],
  "contacts:import": ["CLIENT_OWNER", "MANAGER"],
  "contacts:export": ["CLIENT_OWNER", "MANAGER"],
  // Team presence
  "team:status": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  // Templates & campaigns (business-initiated messaging)
  "templates:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "templates:manage": ["CLIENT_OWNER", "MANAGER"], // create, edit, submit to Meta, delete, sync
  "campaigns:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "campaigns:manage": ["CLIENT_OWNER", "MANAGER"], // build, review, schedule, send, cancel
  "quality:read": ["CLIENT_OWNER", "MANAGER"],
  // Automations
  "automations:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "automations:manage": ["CLIENT_OWNER", "MANAGER"], // build, publish, activate, test, stop runs
  // WhatsApp Flows (in-chat forms)
  "flows:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "flows:manage": ["CLIENT_OWNER", "MANAGER"],
  // AI agent
  "ai:read": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  "ai:manage": ["CLIENT_OWNER", "MANAGER"], // settings, knowledge, activation
  "appointments:manage": ["CLIENT_OWNER", "MANAGER", "AGENT"],
  // Developer access: API keys are owner-only; webhooks are owner/manager
  "api:read": ["CLIENT_OWNER", "MANAGER"], // usage + request logs, key list (never the secret)
  "api:manage": ["CLIENT_OWNER"], // create / rotate / revoke keys
  "webhooks:read": ["CLIENT_OWNER", "MANAGER"],
  "webhooks:manage": ["CLIENT_OWNER", "MANAGER"],
  // Billing and analytics
  "billing:read": ["CLIENT_OWNER", "MANAGER"], // plan, usage, invoices
  "billing:manage": ["CLIENT_OWNER"], // change plan, cancel, pay
  "analytics:read": ["CLIENT_OWNER", "MANAGER"],
} as const satisfies Record<string, readonly OrgRole[]>;

export type OrgPermission = keyof typeof ORG_PERMISSIONS;

export function roleHasPermission(role: OrgRole, permission: OrgPermission): boolean {
  return (ORG_PERMISSIONS[permission] as readonly OrgRole[]).includes(role);
}

/** Owners can assign any role; nobody else can assign roles. */
export function canAssignRole(actorRole: OrgRole, target: OrgRole): boolean {
  return actorRole === "CLIENT_OWNER" && isOrgRole(target);
}

/** Human-readable permission matrix for the Team page. */
export const PERMISSION_LABELS: Partial<Record<OrgPermission, string>> = {
  "inbox:view_all": "See every conversation",
  "inbox:reply": "Reply to customers",
  "inbox:note": "Write internal notes",
  "inbox:claim": "Take unassigned chats",
  "inbox:assign": "Assign chats to anyone",
  "inbox:transfer": "Transfer own chats",
  "contacts:write": "Create & edit contacts",
  "contacts:delete": "Delete contacts",
  "contacts:import": "Import CSV",
  "contacts:export": "Export CSV",
  "members:manage": "Manage team",
  "whatsapp:manage": "Connect WhatsApp numbers",
  "team:status": "Set own availability",
  "templates:manage": "Create & submit templates",
  "campaigns:manage": "Build & send campaigns",
  "quality:read": "View Quality Center",
  "automations:manage": "Build & publish automations",
  "flows:manage": "Build & publish WhatsApp Flows",
  "ai:manage": "Configure the AI agent",
  "appointments:manage": "Confirm appointments",
  "api:read": "View API usage and logs",
  "api:manage": "Create, rotate and revoke API keys",
  "webhooks:read": "View webhook endpoints",
  "webhooks:manage": "Manage webhook endpoints",
  "billing:read": "View plan, usage and invoices",
  "billing:manage": "Change plan, cancel and pay invoices",
  "analytics:read": "View analytics",
};
