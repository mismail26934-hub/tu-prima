"use client";

import { create } from "zustand";

const STORAGE_KEY = "tu-prima-remain-alert-muted";

function readStoredMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface RemainAlertState {
  muted: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

export const useRemainAlertStore = create<RemainAlertState>((set, get) => ({
  muted: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ muted: readStoredMuted(), hydrated: true });
  },
  setMuted: (muted) => {
    set({ muted, hydrated: true });
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  },
  toggleMuted: () => {
    get().setMuted(!get().muted);
  },
}));
