import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    sv?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    /** Session version — must match User.sessionVersion or the session is rejected server-side. */
    sv?: number;
  }
}
