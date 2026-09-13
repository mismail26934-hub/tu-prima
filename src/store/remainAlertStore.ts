"use client";

import { create } from "zustand";

const MUTED_KEY = "tu-prima-remain-alert-muted";
const PCT_KEY = "tu-prima-remain-alert-pct-step";
const HOURS_KEY = "tu-prima-remain-alert-overtime-hours";

export const DEFAULT_PCT_STEP = 5;
export const MIN_PCT_STEP = 1;
export const MAX_PCT_STEP = 20;
export const DEFAULT_OVERTIME_HOURS = 1;
export const MIN_OVERTIME_HOURS = 0.5;
export const MAX_OVERTIME_HOURS = 24;

function readFlag(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch {
    return fallback;
  }
}

export function clampPctStep(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PCT_STEP;
  return Math.min(MAX_PCT_STEP, Math.max(MIN_PCT_STEP, Math.round(value)));
}

export function clampOvertimeHours(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OVERTIME_HOURS;
  const stepped = Math.round(value * 2) / 2;
  return Math.min(MAX_OVERTIME_HOURS, Math.max(MIN_OVERTIME_HOURS, stepped));
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

interface RemainAlertState {
  muted: boolean;
  pctStep: number;
  overtimeHours: number;
  hydrated: boolean;
  hydrate: () => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setPctStep: (pctStep: number) => void;
  setOvertimeHours: (hours: number) => void;
}

export const useRemainAlertStore = create<RemainAlertState>((set, get) => ({
  muted: false,
  pctStep: DEFAULT_PCT_STEP,
  overtimeHours: DEFAULT_OVERTIME_HOURS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({
      muted: readFlag(MUTED_KEY, false),
      pctStep: readNumber(PCT_KEY, DEFAULT_PCT_STEP, MIN_PCT_STEP, MAX_PCT_STEP),
      overtimeHours: readNumber(
        HOURS_KEY,
        DEFAULT_OVERTIME_HOURS,
        MIN_OVERTIME_HOURS,
        MAX_OVERTIME_HOURS
      ),
      hydrated: true,
    });
  },
  setMuted: (muted) => {
    set({ muted, hydrated: true });
    write(MUTED_KEY, muted ? "1" : "0");
  },
  toggleMuted: () => {
    get().setMuted(!get().muted);
  },
  setPctStep: (pctStep) => {
    const next = clampPctStep(pctStep);
    set({ pctStep: next, hydrated: true });
    write(PCT_KEY, String(next));
  },
  setOvertimeHours: (hours) => {
    const next = clampOvertimeHours(hours);
    set({ overtimeHours: next, hydrated: true });
    write(HOURS_KEY, String(next));
  },
}));
