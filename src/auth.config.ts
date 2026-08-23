import type { NextAuthConfig } from "next-auth";
import { AUTH_BASE_PATH } from "@/lib/auth-path";

/** Edge-compatible config only (no Node/fs). Used by middleware. */
export const authConfig = {
  basePath: AUTH_BASE_PATH,
  session: {
    strategy: "jwt",
    maxAge: 10 * 60 * 60, // 10 jam
    updateAge: 60 * 60, // 1 jam
  },
  pages: {
    // Avoid Hostinger WAF blocks on /login and /api/auth/error
    signIn: "/sigin",
    error: "/auth-gagal",
  },
  providers: [],
  trustHost: true,
} satisfies NextAuthConfig;
