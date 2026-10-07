/** Minimal cookie-jar HTTP client that performs the real Auth.js credentials flow. */
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export class Client {
  jar = new Map<string, string>();
  ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.1`;
  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async fetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { cookie: this.cookie, "x-forwarded-for": this.ip, ...(init.headers as Record<string, string>) },
    });
    this.store(res);
    return res;
  }
  async csrf() {
    return ((await (await this.fetch("/api/auth/csrf")).json()) as { csrfToken: string }).csrfToken;
  }
  async login(email: string, password: string) {
    const csrfToken = await this.csrf();
    await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE}/dashboard` }).toString(),
    });
    return [...this.jar.keys()].some((k) => k.endsWith("authjs.session-token"));
  }
  async logout() {
    const csrfToken = await this.csrf();
    await this.fetch("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/login` }).toString(),
    });
  }
}

