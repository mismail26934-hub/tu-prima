import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";
import type { DashboardData } from "@/lib/types";

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api<DashboardData>("/api/dashboard"),
    staleTime: 5_000,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchInterval: () => (shouldHoldServerRefresh() ? false : 8_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: () => !shouldHoldServerRefresh(),
    refetchOnReconnect: true,
  });
}
