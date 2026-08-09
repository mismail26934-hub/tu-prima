import { create } from "zustand";
import type { JobTemplateCategory } from "@/lib/types";

export type JobFormMode = "template" | "custom";

export interface JobFormData {
  mode: JobFormMode;
  category: JobTemplateCategory | "";
  template_id: string;
  title: string;
  unit_id: string;
  description: string;
  estimated_minutes: string;
  steps: string;
}

const emptyForm = (): JobFormData => ({
  mode: "template",
  category: "",
  template_id: "",
  title: "",
  unit_id: "",
  description: "",
  estimated_minutes: "90",
  steps: "",
});

interface JobFormState {
  form: JobFormData;
  setForm: (patch: Partial<JobFormData>) => void;
  resetForm: () => void;
  loadForm: (data: Partial<JobFormData> & Pick<JobFormData, "title" | "unit_id" | "description" | "estimated_minutes" | "steps">) => void;
}

export const useJobFormStore = create<JobFormState>((set) => ({
  form: emptyForm(),
  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  resetForm: () => set({ form: emptyForm() }),
  loadForm: (data) =>
    set({
      form: {
        ...emptyForm(),
        mode: "custom",
        category: "",
        template_id: "",
        ...data,
      },
    }),
}));
