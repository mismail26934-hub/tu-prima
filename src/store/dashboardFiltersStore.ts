"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TechnicianStatus } from "@/lib/types";

export type JobSectionFilter = "all" | "active" | "queue" | "done" | "cancelled";
export type JobOwnershipFilter =
  | "all"
  | "mine"
  | "delegated"
  | "mine_or_delegated";
export type TechStatusFilter = "all" | TechnicianStatus;

const STORAGE_KEY = "tus-dashboard-filters";

export function resolveJobOwnershipFilter(
  mine: boolean,
  delegated: boolean
): JobOwnershipFilter {
  if (mine && delegated) return "mine_or_delegated";
  if (mine) return "mine";
  if (delegated) return "delegated";
  return "all";
}

interface DashboardFiltersState {
  jobSectionFilter: JobSectionFilter;
  jobOwnershipMine: boolean;
  jobOwnershipDelegated: boolean;
  techStatusFilter: TechStatusFilter;
  jobDraft: string;
  jobQuery: string;
  techDraft: string;
  techQuery: string;
  setJobSectionFilter: (value: JobSectionFilter) => void;
  setJobOwnershipMine: (value: boolean) => void;
  setJobOwnershipDelegated: (value: boolean) => void;
  setTechStatusFilter: (value: TechStatusFilter) => void;
  setJobDraft: (draft: string) => void;
  applyJobSearch: () => void;
  clearJobSearch: () => void;
  setTechDraft: (draft: string) => void;
  applyTechSearch: () => void;
  clearTechSearch: () => void;
}

type PersistedV0 = {
  jobOwnershipFilter?: JobOwnershipFilter;
  jobOwnershipMine?: boolean;
  jobOwnershipDelegated?: boolean;
};

export const useDashboardFiltersStore = create<DashboardFiltersState>()(
  persist(
    (set, get) => ({
      jobSectionFilter: "all",
      jobOwnershipMine: false,
      jobOwnershipDelegated: false,
      techStatusFilter: "all",
      jobDraft: "",
      jobQuery: "",
      techDraft: "",
      techQuery: "",
      setJobSectionFilter: (jobSectionFilter) => set({ jobSectionFilter }),
      setJobOwnershipMine: (jobOwnershipMine) => set({ jobOwnershipMine }),
      setJobOwnershipDelegated: (jobOwnershipDelegated) =>
        set({ jobOwnershipDelegated }),
      setTechStatusFilter: (techStatusFilter) => set({ techStatusFilter }),
      setJobDraft: (jobDraft) => set({ jobDraft }),
      applyJobSearch: () => set({ jobQuery: get().jobDraft.trim() }),
      clearJobSearch: () => set({ jobDraft: "", jobQuery: "" }),
      setTechDraft: (techDraft) => set({ techDraft }),
      applyTechSearch: () => set({ techQuery: get().techDraft.trim() }),
      clearTechSearch: () => set({ techDraft: "", techQuery: "" }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => {
        const s = persisted as PersistedV0 & Record<string, unknown>;
        if (typeof s.jobOwnershipMine === "boolean") {
          return persisted as DashboardFiltersState;
        }
        const old = s.jobOwnershipFilter;
        return {
          ...s,
          jobOwnershipMine: old === "mine" || old === "mine_or_delegated",
          jobOwnershipDelegated:
            old === "delegated" || old === "mine_or_delegated",
        };
      },
      partialize: (state) => ({
        jobSectionFilter: state.jobSectionFilter,
        jobOwnershipMine: state.jobOwnershipMine,
        jobOwnershipDelegated: state.jobOwnershipDelegated,
        techStatusFilter: state.techStatusFilter,
        jobDraft: state.jobDraft,
        jobQuery: state.jobQuery,
        techDraft: state.techDraft,
        techQuery: state.techQuery,
      }),
    }
  )
);
