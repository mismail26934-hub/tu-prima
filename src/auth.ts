import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticateUser, getUserByUsername } from "@/lib/excel";
import { authConfig } from "@/auth.config";
import type { UserLevel } from "@/lib/types";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username || "");
        const password = String(credentials?.password || "");
        if (!username || !password) return null;
        const user = await authenticateUser(username, password);
        if (!user) return null;
        return {
          id: user.id,
          name: user.name || user.username,
          email: user.username,
          level: user.level,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id || "";
        token.level = user.level;
      } else if (!token.level && token.email) {
        const storedUser = await getUserByUsername(token.email);
        if (storedUser) {
          token.id = storedUser.id;
          token.level = storedUser.level;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.id || "");
      session.user.level = token.level as UserLevel;
      return session;
    },
  },
});
