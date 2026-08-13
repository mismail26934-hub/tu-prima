import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  applyOptimisticMutation,
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
      return queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
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
    fetchTemplate: (id: string, includeInactive = false) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.templates.detail(id, includeInactive),
        queryFn: () =>
          api<JobTemplate>(
            `/api/job-templates?id=${encodeURIComponent(id)}${
              includeInactive ? "&include_inactive=1" : ""
            }`
          ),
      }),
  };
}

export function useJobActionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      action,
      payload,
    }: {
      jobId: string;
      action: string;
      payload?: Record<string, unknown>;
    }) =>
      api(`/api/jobs/${jobId}/action`, {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      }),
    onMutate: async ({ jobId, action, payload }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardData>(
        queryKeys.dashboard
      );
      const url = `/api/jobs/${jobId}/action`;
      const body = prepareJobActionBody(queryClient, url, "POST", {
        action,
        ...(payload || {}),
      });
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
