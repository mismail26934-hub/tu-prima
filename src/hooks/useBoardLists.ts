import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type {
  JobListSection,
  JobOwnershipFilter,
  PaginatedResult,
} from "@/lib/board-list";
import type { JobWithDetails, TechnicianStatus } from "@/lib/types";
import type { TechnicianListItem } from "@/lib/board-list";

export function useJobsList(opts: {
  section: JobListSection;
  page: number;
  limit: number;
  q?: string;
  ownership?: JobOwnershipFilter;
  enabled?: boolean;
}) {
  const q = opts.q || "";
  const ownership = opts.ownership || "all";
  return useQuery({
    queryKey: queryKeys.board.jobs(
      opts.section,
      opts.page,
      opts.limit,
      q,
      ownership
    ),
    queryFn: () => {
      const params = new URLSearchParams({
        section: opts.section,
        page: String(opts.page),
        limit: String(opts.limit),
        q,
        ownership,
      });
      return api<PaginatedResult<JobWithDetails>>(
        `/api/jobs/list?${params.toString()}`
      );
    },
    enabled: opts.enabled !== false,
    staleTime: 5_000,
  });
}

/** All active jobs for slider (higher limit, page 1). */
export function useActiveJobsSlider(opts: {
  q?: string;
  ownership?: JobOwnershipFilter;
  enabled?: boolean;
}) {
  const q = opts.q || "";
  const ownership = opts.ownership || "all";
  return useQuery({
    queryKey: queryKeys.board.jobSlider(q, ownership),
    queryFn: () => {
      const params = new URLSearchParams({
        section: "active",
        page: "1",
        limit: "100",
        q,
        ownership,
      });
      return api<PaginatedResult<JobWithDetails>>(
        `/api/jobs/list?${params.toString()}`
      );
    },
    enabled: opts.enabled !== false,
    staleTime: 5_000,
  });
}

export function useTechniciansList(opts: {
  status: "all" | TechnicianStatus;
  page: number;
  limit: number;
  q?: string;
  enabled?: boolean;
}) {
  const q = opts.q || "";
  return useQuery({
    queryKey: queryKeys.board.technicians(
      opts.status,
      opts.page,
      opts.limit,
      q
    ),
    queryFn: () => {
      const params = new URLSearchParams({
        status: opts.status,
        page: String(opts.page),
        limit: String(opts.limit),
        q,
      });
      return api<PaginatedResult<TechnicianListItem>>(
        `/api/technicians/list?${params.toString()}`
      );
    },
    enabled: opts.enabled !== false,
    staleTime: 5_000,
  });
}

export function useAssignTechnicianPool(q?: string, enabled = true) {
  const query = q || "";
  return useQuery({
    queryKey: queryKeys.board.assignPool(query),
    queryFn: () => {
      const params = new URLSearchParams({
        status: "available",
        page: "1",
        limit: "500",
        q: query,
      });
      return api<PaginatedResult<TechnicianListItem>>(
        `/api/technicians/list?${params.toString()}`
      );
    },
    enabled,
    staleTime: 10_000,
  });
}
