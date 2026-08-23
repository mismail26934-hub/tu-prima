import { useDashboardFiltersStore } from "./dashboardFiltersStore";

type JobBoardSlice = {
  draft: string;
  query: string;
  setDraft: (draft: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
};

/** @deprecated Prefer useDashboardFiltersStore */
export function useJobBoardStore<T>(selector: (state: JobBoardSlice) => T): T {
  return useDashboardFiltersStore((s) =>
    selector({
      draft: s.jobDraft,
      query: s.jobQuery,
      setDraft: s.setJobDraft,
      applySearch: s.applyJobSearch,
      clearSearch: s.clearJobSearch,
    })
  );
}
