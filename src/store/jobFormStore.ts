import { create } from "zustand";

export interface JobFormData {
  title: string;
  unit: string;
  description: string;
  estimated_minutes: string;
  steps: string;
}

const emptyForm = (): JobFormData => ({
  title: "",
  unit: "",
  description: "",
  estimated_minutes: "90",
  steps: "Diagnosis\nPerbaikan\nTest & QC",
});

interface JobFormState {
  form: JobFormData;
  setForm: (patch: Partial<JobFormData>) => void;
  resetForm: () => void;
  loadForm: (data: JobFormData) => void;
}

export const useJobFormStore = create<JobFormState>((set) => ({
  form: emptyForm(),
  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  resetForm: () => set({ form: emptyForm() }),
  loadForm: (data) => set({ form: data }),
}));
