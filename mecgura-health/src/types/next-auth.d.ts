import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null };
    /** present only for patient-portal sessions: when it was signed in and when it must end regardless of activity (ms) */
    portal?: { sa: number; pexp: number } | null;
    /** staff sessions: when the user signed in (ms), used to cap platform-admin sessions */
    signedInAt?: number | null;
  }
  interface User {
    kind?: "patient";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    /** "patient" for portal sessions */
    kind?: "patient";
    /** signed-in-at (ms). Set once at sign-in and never refreshed, so "log out everywhere" can reject older sessions. */
    sa?: number;
    /** absolute end of a patient session (ms) */
    pexp?: number;
    /** staff sign-in time (ms) */
    sat?: number;
  }
}
