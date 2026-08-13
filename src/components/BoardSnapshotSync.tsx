"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  readBoardSnapshot,
  writeBoardSnapshot,
} from "@/lib/offline/board-snapshot";
import type { DashboardData, JobTemplate } from "@/lib/types";

export function BoardSnapshotSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const snap = readBoardSnapshot();
    if (snap?.dashboard && !queryClient.getQueryData(queryKeys.dashboard)) {
      queryClient.setQueryData(queryKeys.dashboard, snap.dashboard);
    }
    if (
      snap?.templates &&
      !queryClient.getQueryData(queryKeys.templates.catalog)
    ) {
      queryClient.setQueryData(queryKeys.templates.catalog, snap.templates);
    }
    const liveDash = queryClient.getQueryData<DashboardData>(queryKeys.dashboard);
    const liveTpl = queryClient.getQueryData<{ templates: JobTemplate[] }>(
      queryKeys.templates.catalog
    );
    if (liveDash || liveTpl) {
      writeBoardSnapshot({ dashboard: liveDash, templates: liveTpl });
    }

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
    });
    return unsub;
  }, [queryClient]);

  return null;
}
