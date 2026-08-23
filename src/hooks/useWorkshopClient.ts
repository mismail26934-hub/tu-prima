import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  applyOptimisticMutation,
  findTemplate,
  prepareJobActionBody,
} from "@/lib/offline/optimistic";
import { isBrowserOnline } from "@/lib/offline/network";
import { shouldHoldServerRefresh } from "@/lib/offline/sync";
import type { DashboardData, JobTemplate } from "@/lib/types";

export function useWorkshopClient() {
  const queryClient = useQueryClient();

  return {
    queryClient,
    invalidateDashboard: () => {
      if (shouldHoldServerRefresh()) return Promise.resolve();
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.board.all }),
      ]);
    },
    invalidateTemplates: () => {
      if (shouldHoldServerRefresh()) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.templates.all });
    },
    invalidateUsers: () => {
      if (shouldHoldServerRefresh()) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    invalidateBackups: () => {
      if (shouldHoldServerRefresh()) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    },
    fetchTemplate: (id: string, includeInactive = false) => {
      const cached = findTemplate(queryClient, id);
      if (cached && (includeInactive || cached.active !== "0")) {
        return Promise.resolve(cached);
      }
      return queryClient.fetchQuery({
        queryKey: queryKeys.templates.detail(id, includeInactive),
        queryFn: () =>
          api<JobTemplate>(
            `/api/job-templates?id=${encodeURIComponent(id)}${
              includeInactive ? "&include_inactive=1" : ""
            }`
          ),
      });
    },
  };
}

type JobActionVars = {
  jobId: string;
  action: string;
  payload?: Record<string, unknown>;
  /** Filled in onMutate so mutationFn sends the same freeze (avoids 2× timer). */
  __preparedBody?: Record<string, unknown>;
};

export function useJobActionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: JobActionVars) => {
      const { jobId, action, payload, __preparedBody } = vars;
      const body = __preparedBody || { action, ...(payload || {}) };
      return api(`/api/jobs/${jobId}/action`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onMutate: async (vars) => {
      const { jobId, action, payload } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardData>(
        queryKeys.dashboard
      );
      const url = `/api/jobs/${jobId}/action`;
      const body = prepareJobActionBody(queryClient, url, "POST", {
        action,
        ...(payload || {}),
      });
      // Reuse this body in mutationFn/api — second prepare after optimistic
      // complete_step would otherwise double duration_sec.
      vars.__preparedBody = body;
      applyOptimisticMutation(queryClient, "POST", url, JSON.stringify(body));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (!isBrowserOnline()) return;
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.dashboard, context.previous);
      }
    },
    onSettled: () => {
      if (shouldHoldServerRefresh()) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}
