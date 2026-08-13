import type { DashboardData, JobTemplate } from "@/lib/types";

const KEY = "tu-prima-board-snapshot";

type BoardSnapshot = {
  savedAt: number;
  dashboard?: DashboardData;
  templates?: { templates: JobTemplate[] };
};

function readRaw(): BoardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoardSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBoardSnapshot(): BoardSnapshot | null {
  return readRaw();
}

export function writeBoardSnapshot(patch: Partial<BoardSnapshot>) {
  if (typeof window === "undefined") return;
  try {
    const prev = readRaw() || { savedAt: 0 };
    const next: BoardSnapshot = {
      savedAt: Date.now(),
      dashboard: patch.dashboard ?? prev.dashboard,
      templates: patch.templates ?? prev.templates,
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
