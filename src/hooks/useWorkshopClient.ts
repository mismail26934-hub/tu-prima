import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardData, JobStatus, JobTemplate } from "@/lib/types";

function optimisticJobStatus(
  data: DashboardData,
  jobId: string,
  action: string
): DashboardData {
  let status: JobStatus | null = null;
  if (action === "pause") status = "paused";
  else if (action === "resume" || action === "start") status = "in_progress";
  if (!status) return data;
  return {
    ...data,
    jobs: data.jobs.map((job) =>
      job.id === jobId ? { ...job, status } : job
    ),
  };
}

export function useWorkshopClient() {
  const queryClient = useQueryClient();

  return {
    queryClient,
    invalidateDashboard: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    invalidateTemplates: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
    invalidateUsers: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
    invalidateBackups: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all }),
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
    onMutate: async ({ jobId, action }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardData>(
        queryKeys.dashboard
      );
      if (previous) {
        queryClient.setQueryData(
          queryKeys.dashboard,
          optimisticJobStatus(previous, jobId, action)
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.dashboard, context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  });
}
