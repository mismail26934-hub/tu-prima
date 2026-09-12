"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";
import { isBrowserOnline } from "@/lib/offline/network";
import {
  EMPTY_NAV_ALERTS,
  type NavAlertsPayload,
} from "@/lib/nav-alerts";

export function useNavAlerts(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.alerts,
    queryFn: () => api<NavAlertsPayload>("/api/alerts"),
    enabled,
    placeholderData: EMPTY_NAV_ALERTS,
    staleTime: 5_000,
    refetchInterval: () =>
      enabled && !shouldHoldServerRefresh() && isBrowserOnline() ? 8_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: () => !shouldHoldServerRefresh(),
    refetchOnReconnect: () => !shouldHoldServerRefresh(),
    retry: false,
  });
}
