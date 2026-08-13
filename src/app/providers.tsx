"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SessionProvider, type SessionProviderProps } from "next-auth/react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { del, get, set } from "idb-keyval";
import { bindQueryClient } from "@/lib/offline/query-bridge";
import { startOutboxSync } from "@/lib/offline/sync";
import { readCachedSession } from "@/lib/offline/session-cache";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SessionCache } from "@/components/SessionCache";

const CACHE_KEY = "tu-prima-query";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const noopStorage = {
  getItem: async () => null as string | null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: MAX_AGE_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
        networkMode: "offlineFirst",
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 0,
      },
    },
  });
}

const idbStorage = {
  getItem: async (key: string) => {
    const value = await get(key);
    return typeof value === "string" ? value : null;
  },
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
};

let browserPersister: ReturnType<typeof createAsyncStoragePersister> | null =
  null;

function getPersister() {
  if (typeof window === "undefined") {
    return createAsyncStoragePersister({
      storage: noopStorage,
      key: CACHE_KEY,
    });
  }
  if (!browserPersister) {
    browserPersister = createAsyncStoragePersister({
      storage: idbStorage,
      key: CACHE_KEY,
    });
  }
  return browserPersister;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const persister = getPersister();
  const [offlineSession, setOfflineSession] = useState<
    SessionProviderProps["session"]
  >(undefined);

  useEffect(() => {
    bindQueryClient(queryClient);
    startOutboxSync();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const cached = readCachedSession();
      if (cached?.user) {
        setOfflineSession(cached as SessionProviderProps["session"]);
      }
    }
  }, [queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: MAX_AGE_MS,
        buster: "catalog-v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            if (query.state.status !== "success") return false;
            const key = query.queryKey[0];
            if (query.queryKey[1] === "category") return false;
            return (
              key === "dashboard" ||
              key === "job-templates" ||
              key === "users"
            );
          },
        },
      }}
    >
      <SessionProvider
        session={offlineSession}
        refetchOnWindowFocus={true}
        refetchInterval={0}
      >
        <ServiceWorkerRegister />
        <SessionCache />
        {children}
        {process.env.NODE_ENV === "development" ? (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        ) : null}
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
