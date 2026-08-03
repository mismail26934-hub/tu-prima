import { create } from "zustand";

interface AssignState {
  jobId: string | null;
  techIds: string[];
  /** Text typed in input (not applied yet). */
  draft: string;
  /** Applied search used for filtering the list. */
  query: string;
  openForJob: (jobId: string, existingTechIds?: string[]) => void;
  setDraft: (draft: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
  toggleTech: (techId: string) => void;
  reset: () => void;
}

export const useAssignStore = create<AssignState>((set, get) => ({
  jobId: null,
  techIds: [],
  draft: "",
  query: "",
  openForJob: (jobId, existingTechIds = []) =>
    set({
      jobId,
      techIds: [...existingTechIds],
      draft: "",
      query: "",
    }),
  setDraft: (draft) => set({ draft }),
  applySearch: () => set({ query: get().draft.trim() }),
  clearSearch: () => set({ draft: "", query: "" }),
  toggleTech: (techId) =>
    set((state) => ({
      techIds: state.techIds.includes(techId)
        ? state.techIds.filter((id) => id !== techId)
        : [...state.techIds, techId],
    })),
  reset: () => set({ jobId: null, techIds: [], draft: "", query: "" }),
}));
