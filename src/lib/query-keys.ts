export const queryKeys = {
  dashboard: ["dashboard"] as const,
  board: {
    all: ["board"] as const,
    jobs: (
      section: string,
      page: number,
      limit: number,
      q: string,
      ownership: string,
      cursor?: string | null
    ) =>
      [
        "board",
        "jobs",
        section,
        page,
        limit,
        q,
        ownership,
        cursor ?? "",
      ] as const,
    jobSlider: (q: string, ownership: string) =>
      ["board", "jobs", "active", "slider", q, ownership] as const,
    technicians: (
      status: string,
      page: number,
      limit: number,
      q: string
    ) => ["board", "technicians", status, page, limit, q] as const,
    assignPool: (q: string) => ["board", "technicians", "assign", q] as const,
  },
  templates: {
    all: ["job-templates"] as const,
    catalog: ["job-templates", "catalog"] as const,
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
