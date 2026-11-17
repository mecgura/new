/**
 * Some forms and mail tools hand over names as quoted-printable text ("=52=61=6E=69" instead of "Rani").
 * Turns that back into the real name. Anything else is returned unchanged.
 */
export function cleanPersonName(raw: string): string {
  const s = raw.trim();
  if (!/(?:=[0-9A-Fa-f]{2}){3,}/.test(s)) return s;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(...Buffer.from(s[i], "utf8"));
    }
    const out = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)).replace(/\s+/g, " ").trim();
    return out || s;
  } catch {
    return s;
  }
}
