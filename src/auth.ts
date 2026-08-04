import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const SESSION_MAX_AGE_SEC = 10 * 60 * 60; // 10 jam
const SESSION_UPDATE_AGE_SEC = 60 * 60; // 1 jam

function getEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return typeof value === "string" ? value : fallback;
}

const authConfig = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SEC,
    updateAge: SESSION_UPDATE_AGE_SEC,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize(credentials) {
        const username = getEnv("APP_USERNAME", "admin");
        const password = getEnv("APP_PASSWORD", "admin123");
        if (
          credentials?.username === username &&
          credentials?.password === password
        ) {
          return {
            id: "app-user",
            name: username,
          };
        }
        return null;
      },
    }),
  ],
});

export const { handlers, auth, signIn, signOut } = authConfig;
