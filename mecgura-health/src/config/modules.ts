/** Product modules. A tenant's plan decides which are enabled (Plan.modules). */
export const MODULE_KEYS = [
  "dashboard", "patients", "opd", "appointments", "consultations", "prescriptions", "tests",
  "documents", "tasks", "billing", "inventory", "followups", "communications", "analytics",
  "website", "settings", "team", "platform",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Modules with a real implementation. Flip to "available" only when a phase ships the module. */
export const MODULE_STATUS: Record<ModuleKey, "available" | "planned"> = {
  dashboard: "available",
  settings: "available",
  patients: "available",
  opd: "available",
  appointments: "available",
  consultations: "planned",
  prescriptions: "planned",
  tests: "planned",
  documents: "planned",
  tasks: "planned",
  billing: "planned",
  inventory: "planned",
  followups: "planned",
  communications: "planned",
  analytics: "planned",
  website: "available",
  team: "available",
  platform: "available",
};

/** Always-on foundation modules (every plan includes them). */
export const CORE_MODULES: readonly ModuleKey[] = ["dashboard", "settings", "team", "website", "appointments", "opd", "patients"];

export function parseModules(json: string | null | undefined): ModuleKey[] {
  try {
    const raw = JSON.parse(json ?? "[]");
    const list = Array.isArray(raw) ? raw.filter((m): m is ModuleKey => (MODULE_KEYS as readonly string[]).includes(m)) : [];
    return Array.from(new Set([...CORE_MODULES, ...list]));
  } catch {
    return [...CORE_MODULES];
  }
}
