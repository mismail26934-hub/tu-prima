"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TechnicianStatus } from "@/lib/types";

export type JobSectionFilter = "all" | "active" | "queue" | "done" | "cancelled";
export type JobOwnershipFilter = "all" | "mine" | "delegated";
export type TechStatusFilter = "all" | TechnicianStatus;

const STORAGE_KEY = "tus-dashboard-filters";

interface DashboardFiltersState {
  jobSectionFilter: JobSectionFilter;
  jobOwnershipFilter: JobOwnershipFilter;
  techStatusFilter: TechStatusFilter;
  jobDraft: string;
  jobQuery: string;
  techDraft: string;
  techQuery: string;
  setJobSectionFilter: (value: JobSectionFilter) => void;
  setJobOwnershipFilter: (value: JobOwnershipFilter) => void;
  setTechStatusFilter: (value: TechStatusFilter) => void;
  setJobDraft: (draft: string) => void;
  applyJobSearch: () => void;
  clearJobSearch: () => void;
  setTechDraft: (draft: string) => void;
  applyTechSearch: () => void;
  clearTechSearch: () => void;
}

export const useDashboardFiltersStore = create<DashboardFiltersState>()(
  persist(
    (set, get) => ({
      jobSectionFilter: "all",
      jobOwnershipFilter: "all",
      techStatusFilter: "all",
      jobDraft: "",
      jobQuery: "",
      techDraft: "",
      techQuery: "",
      setJobSectionFilter: (jobSectionFilter) => set({ jobSectionFilter }),
      setJobOwnershipFilter: (jobOwnershipFilter) => set({ jobOwnershipFilter }),
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        jobSectionFilter: state.jobSectionFilter,
        jobOwnershipFilter: state.jobOwnershipFilter,
        techStatusFilter: state.techStatusFilter,
        jobDraft: state.jobDraft,
        jobQuery: state.jobQuery,
        techDraft: state.techDraft,
        techQuery: state.techQuery,
      }),
    }
  )
);
