"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_MASTER_HANDOVER_COLUMN_PREFS,
  normalizeMasterHandoverColumnPrefs,
  type MasterHandoverColumnId,
  type MasterHandoverColumnPrefs,
} from "@/lib/master-handover-columns";

const STORAGE_KEY = "tus-master-handover-columns-v3";

type State = MasterHandoverColumnPrefs & {
  setHidden: (id: MasterHandoverColumnId, hidden: boolean) => void;
  setFrozen: (id: MasterHandoverColumnId, frozen: boolean) => void;
  move: (id: MasterHandoverColumnId, dir: -1 | 1) => void;
  reset: () => void;
};

export const useMasterHandoverColumnsStore = create<State>()(
  persist(
    (set, get) => ({
      ...DEFAULT_MASTER_HANDOVER_COLUMN_PREFS,
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
      reset: () => set({ ...DEFAULT_MASTER_HANDOVER_COLUMN_PREFS }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): MasterHandoverColumnPrefs => ({
        order: s.order,
        hidden: s.hidden,
        frozen: s.frozen,
      }),
      merge: (persisted, current) => {
        const prefs = normalizeMasterHandoverColumnPrefs(
          (persisted || {}) as Partial<MasterHandoverColumnPrefs>
        );
        return { ...current, ...prefs };
      },
    }
  )
);
