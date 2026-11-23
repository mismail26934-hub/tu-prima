"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_BACKUP_COLUMN_PREFS,
  normalizeBackupColumnPrefs,
  type BackupColumnId,
  type BackupColumnPrefs,
} from "@/lib/backup-columns";

const STORAGE_KEY = "tus-backup-columns-v1";

type State = BackupColumnPrefs & {
  setHidden: (id: BackupColumnId, hidden: boolean) => void;
  setFrozen: (id: BackupColumnId, frozen: boolean) => void;
  move: (id: BackupColumnId, dir: -1 | 1) => void;
  reset: () => void;
};

export const useBackupColumnsStore = create<State>()(
  persist(
    (set, get) => ({
      ...DEFAULT_BACKUP_COLUMN_PREFS,
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
      reset: () => set({ ...DEFAULT_BACKUP_COLUMN_PREFS }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): BackupColumnPrefs => ({
        order: s.order,
        hidden: s.hidden,
        frozen: s.frozen,
      }),
      merge: (persisted, current) => {
        const prefs = normalizeBackupColumnPrefs(
          (persisted || {}) as Partial<BackupColumnPrefs>
        );
        return { ...current, ...prefs };
      },
    }
  )
);
