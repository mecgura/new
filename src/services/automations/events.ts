import type { AutomationEvent } from "@/services/automations/engine";

/**
 * Fire-and-forget hook used by contacts / inbox code. Loaded lazily so the
 * inbox modules don't import the engine at module-evaluation time. Never
 * throws: an automation problem must not break the action that caused it.
 */
export async function emitAutomationEvent(organizationId: string, ev: AutomationEvent): Promise<boolean> {
  try {
    const { dispatch } = await import("@/services/automations/engine");
    return await dispatch(organizationId, ev);
  } catch (e) {
    console.error("[automations] event failed:", e);
    return false;
  }
}
