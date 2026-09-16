"use client";

import { useLayoutEffect, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  readBoardSnapshot,
  writeBoardSnapshot,
} from "@/lib/offline/board-snapshot";
import {
  clearBrowserUnreachable,
  markBrowserUnreachable,
} from "@/lib/offline/network";
import type { AppUserPublic, DashboardData, JobTemplate } from "@/lib/types";

export function BoardSnapshotSync() {
  const queryClient = useQueryClient();

  // Seed before paint so DevTools Offline refresh does not flash full shimmer.
  useLayoutEffect(() => {
    const snap = readBoardSnapshot();
    if (snap?.dashboard) {
      queryClient.setQueryData(queryKeys.dashboard, snap.dashboard);
    }
    if (snap?.templates) {
      queryClient.setQueryData(queryKeys.templates.catalog, snap.templates);
    }
    if (snap?.foremen?.length) {
      queryClient.setQueryData(queryKeys.foremen, snap.foremen);
    }
  }, [queryClient]);

  useEffect(() => {
    const applySnap = () => {
      const snap = readBoardSnapshot();
      if (snap?.dashboard) {
        queryClient.setQueryData(queryKeys.dashboard, snap.dashboard);
      }
      if (snap?.templates) {
        queryClient.setQueryData(queryKeys.templates.catalog, snap.templates);
      }
      if (snap?.foremen?.length) {
        queryClient.setQueryData(queryKeys.foremen, snap.foremen);
      }
    };

    const onOffline = () => {
      markBrowserUnreachable();
      applySnap();
    };
    const onOnline = () => {
      clearBrowserUnreachable();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // Probe once: DevTools Offline often keeps onLine=true but blocks fetch.
    // Only mark offline on transport failure — HTTP 401/500 means we ARE online.
    const probe = window.setTimeout(() => {
      if (!navigator.onLine) {
        markBrowserUnreachable();
        applySnap();
        return;
      }
      const ctrl = new AbortController();
      const kill = window.setTimeout(() => ctrl.abort(), 2500);
      fetch("/api/dashboard", {
        method: "GET",
        signal: ctrl.signal,
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((res) => {
          if (res.type === "error" || res.status === 0) {
            markBrowserUnreachable();
            applySnap();
            return;
          }
          clearBrowserUnreachable();
        })
        .catch((err) => {
          const aborted =
            err instanceof DOMException && err.name === "AbortError";
          // Slow server during boot: don't sticky-offline on our own abort.
          if (aborted && navigator.onLine) {
            clearBrowserUnreachable();
            return;
          }
          markBrowserUnreachable();
          applySnap();
        })
        .finally(() => clearTimeout(kill));
    }, 0);

    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "added" && event.type !== "updated") return;
      if (event.query.state.status !== "success") return;
      const key0 = event.query.queryKey[0];
      const key1 = event.query.queryKey[1];
      if (key0 === "dashboard") {
        writeBoardSnapshot({
          dashboard: event.query.state.data as DashboardData,
        });
      }
      if (key0 === "job-templates" && key1 === "catalog") {
        writeBoardSnapshot({
          templates: event.query.state.data as { templates: JobTemplate[] },
        });
      }
      if (key0 === "users" && key1 === "foremen") {
        const list = event.query.state.data as AppUserPublic[] | undefined;
        if (Array.isArray(list) && list.length) {
          writeBoardSnapshot({ foremen: list });
        }
      }
    });
    return () => {
      window.clearTimeout(probe);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      unsub();
    };
  }, [queryClient]);

  return null;
}
