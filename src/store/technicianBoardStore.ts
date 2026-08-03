import { create } from "zustand";

interface TechnicianBoardState {
  /** Text currently typed in the input (not yet applied). */
  draft: string;
  /** Applied query used for filtering. */
  query: string;
  setDraft: (draft: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
}

export const useTechnicianBoardStore = create<TechnicianBoardState>((set, get) => ({
  draft: "",
  query: "",
  setDraft: (draft) => set({ draft }),
  applySearch: () => set({ query: get().draft.trim() }),
  clearSearch: () => set({ draft: "", query: "" }),
}));
