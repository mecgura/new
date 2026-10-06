export type HostMatch = { kind: "subdomain"; value: string } | { kind: "custom"; value: string } | null;

/**
 * Maps a Host header to a tenant lookup key.
 *   clinic.health.example.com  (root = health.example.com)  -> subdomain "clinic"
 *   drsharma.com                                            -> custom domain
 *   health.example.com / localhost                          -> null (platform / no tenant)
 */
export function parseTenantHost(hostHeader: string | null | undefined, rootDomain?: string): HostMatch {
  if (!hostHeader) return null;
  const host = hostHeader.toLowerCase().split(":")[0].trim();
  if (!host || host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const root = rootDomain?.toLowerCase().trim();
  if (root) {
    if (host === root || host === `www.${root}`) return null;
    if (host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1));
      return /^[a-z0-9-]+$/.test(label) ? { kind: "subdomain", value: label } : null;
    }
  }
  return { kind: "custom", value: host };
}
