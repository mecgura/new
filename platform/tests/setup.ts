import { vi } from "vitest";

process.env.DATABASE_URL = "file:./test.db";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";

/**
 * The Auth.js session is replaced by a controllable fake so route handlers can
 * be exercised as specific users. Everything below it — DB lookups, session
 * version checks, membership/role/tenant checks — is the real code.
 */
import { fakeSession } from "./fake-session";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => fakeSession.current),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));
