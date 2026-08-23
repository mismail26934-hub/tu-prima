import { useDashboardFiltersStore } from "./dashboardFiltersStore";

type TechnicianBoardSlice = {
  draft: string;
  query: string;
  setDraft: (draft: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
};

/** @deprecated Prefer useDashboardFiltersStore */
export function useTechnicianBoardStore<T>(
  selector: (state: TechnicianBoardSlice) => T
): T {
  return useDashboardFiltersStore((s) =>
    selector({
      draft: s.techDraft,
      query: s.techQuery,
      setDraft: s.setTechDraft,
      applySearch: s.applyTechSearch,
      clearSearch: s.clearTechSearch,
    })
  );
}
