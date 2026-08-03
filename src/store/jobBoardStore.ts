import { create } from "zustand";

interface JobBoardState {
  draft: string;
  query: string;
  setDraft: (draft: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
}

export const useJobBoardStore = create<JobBoardState>((set, get) => ({
  draft: "",
  query: "",
  setDraft: (draft) => set({ draft }),
  applySearch: () => set({ query: get().draft.trim() }),
  clearSearch: () => set({ draft: "", query: "" }),
}));
