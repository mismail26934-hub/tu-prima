import type { DefaultSession } from "next-auth";
import type { UserLevel } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      level: UserLevel;
    };
  }

  interface User {
    level: UserLevel;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    level: UserLevel;
  }
}
