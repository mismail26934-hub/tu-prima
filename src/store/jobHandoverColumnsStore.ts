"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_JOB_HANDOVER_COLUMN_PREFS,
  normalizeJobHandoverColumnPrefs,
  type JobHandoverColumnId,
  type JobHandoverColumnPrefs,
} from "@/lib/job-handover-columns";

const STORAGE_KEY = "tus-job-handover-columns-v2";

type State = JobHandoverColumnPrefs & {
  setHidden: (id: JobHandoverColumnId, hidden: boolean) => void;
  setFrozen: (id: JobHandoverColumnId, frozen: boolean) => void;
  move: (id: JobHandoverColumnId, dir: -1 | 1) => void;
  reset: () => void;
};

export const useJobHandoverColumnsStore = create<State>()(
  persist(
    (set, get) => ({
      ...DEFAULT_JOB_HANDOVER_COLUMN_PREFS,
      setHidden: (id, hidden) => {
        const cur = get();
        const nextHidden = new Set(cur.hidden);
        if (hidden) nextHidden.add(id);
        else nextHidden.delete(id);
        set({
          hidden: [...nextHidden],
        });
      },
      setFrozen: (id, frozen) => {
        const cur = get();
        const next = new Set(cur.frozen);
        if (frozen) next.add(id);
        else next.delete(id);
        set({ frozen: [...next] });
      },
      move: (id, dir) => {
        const order = [...get().order];
        const i = order.indexOf(id);
        if (i < 0) return;
        const j = i + dir;
        if (j < 0 || j >= order.length) return;
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
        set({ order });
      },
      reset: () => set({ ...DEFAULT_JOB_HANDOVER_COLUMN_PREFS }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): JobHandoverColumnPrefs => ({
        order: s.order,
        hidden: s.hidden,
        frozen: s.frozen,
      }),
      merge: (persisted, current) => {
        const prefs = normalizeJobHandoverColumnPrefs(
          (persisted || {}) as Partial<JobHandoverColumnPrefs>
        );
        return { ...current, ...prefs };
      },
    }
  )
);
