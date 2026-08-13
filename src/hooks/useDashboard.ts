import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";
import { isBrowserOnline } from "@/lib/offline/network";
import { readBoardSnapshot, writeBoardSnapshot } from "@/lib/offline/board-snapshot";
import type { DashboardData } from "@/lib/types";

async function loadDashboard(): Promise<DashboardData> {
  const snap = readBoardSnapshot()?.dashboard;
  if (snap && (shouldHoldServerRefresh() || !isBrowserOnline())) {
    return snap;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const data = await api<DashboardData>("/api/dashboard", {
      signal: ctrl.signal,
    });
    writeBoardSnapshot({ dashboard: data });
    return data;
  } catch (error) {
    if (snap) return snap;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: loadDashboard,
    staleTime: 5_000,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchInterval: () => (shouldHoldServerRefresh() ? false : 8_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: () => !shouldHoldServerRefresh(),
    refetchOnReconnect: () => !shouldHoldServerRefresh(),
    refetchOnMount: () => !shouldHoldServerRefresh(),
    retry: false,
  });
}
