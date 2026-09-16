import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";
import { isBrowserOnline } from "@/lib/offline/network";
import { readBoardSnapshot, writeBoardSnapshot } from "@/lib/offline/board-snapshot";
import type { DashboardData } from "@/lib/types";

/** Race only to prefer snap when hung (DevTools Offline); must exceed slow API. */
const DASHBOARD_FETCH_MS = 10_000;

async function loadDashboard(): Promise<DashboardData> {
  const snap = readBoardSnapshot()?.dashboard;

  // Real Wi-Fi off sets onLine=false. DevTools Offline often keeps onLine=true
  // while blocking fetch — still serve the local snapshot immediately.
  if (snap && (!isBrowserOnline() || shouldHoldServerRefresh())) {
    return snap;
  }

  try {
    const data = await Promise.race([
      api<DashboardData>("/api/dashboard"),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TypeError("Failed to fetch")),
          DASHBOARD_FETCH_MS
        );
      }),
    ]);
    writeBoardSnapshot({ dashboard: data });
    return data;
  } catch (error) {
    // Prefer local snapshot; sticky-offline is set by fetchWithTimeout only on
    // real transport failures (not slow server / HTTP errors).
    if (snap) return snap;
    throw error;
  }
}

function isNarrowBoard() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 720px)").matches
  );
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: loadDashboard,
    staleTime: 5_000,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchInterval: () => {
      if (shouldHoldServerRefresh() || !isBrowserOnline()) return false;
      return isNarrowBoard() ? 20_000 : 8_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: () =>
      !shouldHoldServerRefresh() &&
      isBrowserOnline() &&
      !isNarrowBoard(),
    refetchOnReconnect: () => !shouldHoldServerRefresh() && isBrowserOnline(),
    // DevTools Offline often reports onLine=true; avoid blocking first paint
    // on a hung network when we already have a local snapshot.
    refetchOnMount: () => {
      if (!isBrowserOnline() || shouldHoldServerRefresh()) return false;
      if (readBoardSnapshot()?.dashboard && !isBrowserOnline()) return false;
      return true;
    },
    retry: false,
    networkMode: "offlineFirst",
  });
}
