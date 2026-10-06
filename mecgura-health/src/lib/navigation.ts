import { NAV_ITEMS, type NavItemView } from "@/config/navigation";
import { MODULE_STATUS, type ModuleKey } from "@/config/modules";
import { can, type RoleKey } from "@/lib/permissions";

/**
 * Role-, plan- and implementation-aware navigation. Pure function (unit-tested).
 *  - role gate:   the role must hold the item's permission
 *  - plan gate:   the module must be enabled by the tenant's plan
 *  - build gate:  modules not built yet are hidden, or shown as disabled "Soon" entries when
 *                 `showPlanned` is on (development / SHOW_PLANNED_MODULES)
 * This only controls what is DISPLAYED. Pages and APIs enforce permissions server-side.
 */
export function getVisibleNav(opts: { role: RoleKey; enabledModules: readonly ModuleKey[]; showPlanned: boolean }): NavItemView[] {
  const enabled = new Set(opts.enabledModules);
  return NAV_ITEMS.filter((item) => enabled.has(item.module) && can(opts.role, item.permission))
    .map((item) => ({ ...item, planned: MODULE_STATUS[item.module] === "planned" }))
    .filter((item) => !item.planned || opts.showPlanned);
}
