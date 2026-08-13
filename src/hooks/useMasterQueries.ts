import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type {
  AppUserPublic,
  JobChangeBackup,
  JobTemplate,
  JobTemplateSummary,
} from "@/lib/types";

export function useMasterTemplates(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.templates.master,
    queryFn: () =>
      api<{ templates: JobTemplate[] }>(
        "/api/job-templates?include_inactive=1"
      ),
    enabled,
    staleTime: 30_000,
  });
}

export function useTemplateCatalog() {
  return useQuery({
    queryKey: queryKeys.templates.catalog,
    queryFn: () =>
      api<{ templates: JobTemplate[] }>("/api/job-templates?full=1"),
    staleTime: 30_000,
  });
}

export function useTemplateSummaries(category: string | undefined) {
  const catalog = useTemplateCatalog();
  const templates: JobTemplateSummary[] = (catalog.data?.templates || [])
    .filter((t) => t.active !== "0")
    .filter((t) => Boolean(category) && t.category === category)
    .map((t) => ({
      id: t.id,
      category: t.category,
      name: t.name,
      std_minutes: t.std_minutes,
      step_count: t.steps?.length ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    data: { templates },
    isFetching: catalog.isFetching && !catalog.data,
  };
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api<AppUserPublic[]>("/api/users"),
    enabled,
    staleTime: 15_000,
  });
}

export function useJobBackups(includeUndone: boolean, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.backups.list(includeUndone),
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "80",
        includeUndone: includeUndone ? "1" : "0",
      });
      const res = await api<{ items?: JobChangeBackup[] }>(
        `/api/backups/jobs?${params}`
      );
      return res.items || [];
    },
    enabled,
    staleTime: 10_000,
  });
}
