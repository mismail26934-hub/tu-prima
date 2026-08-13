export const queryKeys = {
  dashboard: ["dashboard"] as const,
  templates: {
    all: ["job-templates"] as const,
    master: ["job-templates", "master"] as const,
    byCategory: (category: string) =>
      ["job-templates", "category", category] as const,
    detail: (id: string, includeInactive = false) =>
      ["job-templates", "detail", id, { includeInactive }] as const,
  },
  users: ["users"] as const,
  backups: {
    all: ["job-backups"] as const,
    list: (includeUndone: boolean) =>
      ["job-backups", { includeUndone }] as const,
  },
};
