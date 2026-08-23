"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SessionProvider, type SessionProviderProps } from "next-auth/react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { del, get, set } from "idb-keyval";
import { bindQueryClient } from "@/lib/offline/query-bridge";
import { startOutboxSync, shouldHoldServerRefresh } from "@/lib/offline/sync";
import { readCachedSession } from "@/lib/offline/session-cache";
import { readBoardSnapshot, writeBoardSnapshot } from "@/lib/offline/board-snapshot";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardData, JobTemplate } from "@/lib/types";
import { AUTH_BASE_PATH } from "@/lib/auth-path";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SessionCache } from "@/components/SessionCache";
import { BoardSnapshotSync } from "@/components/BoardSnapshotSync";
import { RealtimeBridge } from "@/components/RealtimeBridge";

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
        refetchOnWindowFocus: () => !shouldHoldServerRefresh(),
        refetchOnReconnect: () => !shouldHoldServerRefresh(),
        refetchOnMount: () => !shouldHoldServerRefresh(),
        retry: (count) => (!shouldHoldServerRefresh() && count < 1),
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
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
    }
    return null;
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
      throttleTime: 100,
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
    const snap = readBoardSnapshot();
    if (snap?.dashboard) {
      queryClient.setQueryData(queryKeys.dashboard, snap.dashboard);
    }
    if (snap?.templates) {
      queryClient.setQueryData(queryKeys.templates.catalog, snap.templates);
    }
    const cached = readCachedSession();
    if (cached?.user) {
      setOfflineSession(cached as SessionProviderProps["session"]);
    }
    startOutboxSync();
  }, [queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      onSuccess={() => {
        const dashboard = queryClient.getQueryData<DashboardData>(
          queryKeys.dashboard
        );
        const templates = queryClient.getQueryData<{ templates: JobTemplate[] }>(
          queryKeys.templates.catalog
        );
        if (dashboard || templates) {
          writeBoardSnapshot({
            dashboard,
            templates,
          });
        }
      }}
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
        basePath={AUTH_BASE_PATH}
        session={offlineSession}
        refetchOnWindowFocus={true}
        refetchInterval={0}
      >
        <ServiceWorkerRegister />
        <SessionCache />
        <BoardSnapshotSync />
        <RealtimeBridge />
        {children}
        {process.env.NODE_ENV === "development" ? (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        ) : null}
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
