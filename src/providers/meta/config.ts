/**
 * Meta (WhatsApp Cloud API) platform configuration — MECGURA's own Meta app.
 * Server-only values (app secret, verify token) never leave this module except
 * through `publicMetaConfig()`, which exposes only browser-safe ids.
 */
export type MetaConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  graphVersion: string;
  webhookVerifyToken: string;
};

export const DEFAULT_GRAPH_VERSION = "v23.0";

export function getMetaConfig(): MetaConfig {
  return {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "",
    graphVersion: process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION,
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
  };
}

/** Names (never values) of the variables still needed for Embedded Signup. */
export function missingMetaConfig(): string[] {
  const c = getMetaConfig();
  return [
    !c.appId && "META_APP_ID",
    !c.appSecret && "META_APP_SECRET",
    !c.configId && "META_EMBEDDED_SIGNUP_CONFIG_ID",
    !c.webhookVerifyToken && "META_WEBHOOK_VERIFY_TOKEN",
  ].filter(Boolean) as string[];
}

export function isMetaConfigured(): boolean {
  return missingMetaConfig().length === 0;
}

/** Demo mode: on when Meta isn't configured, unless WHATSAPP_DEMO_MODE=off; forced on with WHATSAPP_DEMO_MODE=on. */
export function isDemoAvailable(): boolean {
  const flag = process.env.WHATSAPP_DEMO_MODE;
  if (flag === "off") return false;
  if (flag === "on") return true;
  return !isMetaConfigured();
}

export function publicMetaConfig() {
  const c = getMetaConfig();
  return { appId: c.appId, configId: c.configId, graphVersion: c.graphVersion };
}
