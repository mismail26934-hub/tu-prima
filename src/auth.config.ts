import type { NextAuthConfig } from "next-auth";

/** Edge-compatible config only (no Node/fs). Used by middleware. */
export const authConfig = {
  session: {
    strategy: "jwt",
    maxAge: 10 * 60 * 60, // 10 jam
    updateAge: 60 * 60, // 1 jam
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
  trustHost: true,
} satisfies NextAuthConfig;
