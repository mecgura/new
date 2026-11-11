import { CHANNELS, type Channel } from "./catalog";
import { configuredProvider } from "./providers/registry";
import { channelEnabled, loadSettings } from "./settings";

/** A channel is really usable only when the clinic switched it on AND the server has a configured provider for it. */
export async function usableChannels(tenantId: string): Promise<Record<Channel, boolean>> {
  const s = await loadSettings(tenantId);
  return Object.fromEntries(CHANNELS.map((c) => [c, channelEnabled(s, c) && !!configuredProvider(c)])) as Record<Channel, boolean>;
}
