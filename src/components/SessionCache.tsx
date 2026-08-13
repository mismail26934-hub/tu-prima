"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { writeCachedSession } from "@/lib/offline/session-cache";

export function SessionCache() {
  const { data } = useSession();

  useEffect(() => {
    writeCachedSession(
      data
        ? {
            user: {
              id: data.user?.id,
              name: data.user?.name,
              email: data.user?.email,
              level: data.user?.level,
            },
            expires: data.expires,
          }
        : null
    );
  }, [data]);

  return null;
}
