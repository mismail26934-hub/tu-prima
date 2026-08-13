"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { writeCachedSession } from "@/lib/offline/session-cache";

export function SessionCache() {
  const { data, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (!data?.user) return;
    writeCachedSession({
      user: {
        id: data.user?.id,
        name: data.user?.name,
        email: data.user?.email,
        level: data.user?.level,
      },
      expires: data.expires,
    });
  }, [data, status]);

  return null;
}
