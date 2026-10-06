import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { WORKSPACE_COOKIE, createWorkspaceToken } from "./workspace-cookie";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export async function setWorkspaceCookie(userId: string, tenantId: string) {
  (await cookies()).set(WORKSPACE_COOKIE, createWorkspaceToken(secret(), userId, tenantId), {
    httpOnly: true, sameSite: "lax", secure: getEnv().isProd, path: "/", maxAge: 60 * 60 * 8,
  });
}

export async function clearWorkspaceCookie() {
  (await cookies()).delete(WORKSPACE_COOKIE);
}
