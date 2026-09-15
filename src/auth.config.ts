import type { NextAuthConfig } from "next-auth";
import { AUTH_BASE_PATH } from "@/lib/auth-path";

function authUrlIsHttps() {
  const url = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "";
  return url.startsWith("https://");
}

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
    signIn: "/sign-in",
    error: "/auth-gagal",
  },
  providers: [],
  trustHost: true,
  // Chrome rejects Secure cookies on http://hostname:3000 (`npm start` / production).
  useSecureCookies: authUrlIsHttps(),
  cookies: authUrlIsHttps()
    ? undefined
    : {
        sessionToken: {
          name: "authjs.session-token",
          options: {
            httpOnly: true,
            sameSite: "lax" as const,
            path: "/",
            secure: false,
          },
        },
      },
} satisfies NextAuthConfig;
