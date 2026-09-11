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
      cursor?: string | null,
      priority?: string,
      jobId?: string
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
        priority || "",
        jobId || "",
      ] as const,
    jobSlider: (q: string, ownership: string, priority?: string, jobId?: string) =>
      [
        "board",
        "jobs",
        "active",
        "slider",
        q,
        ownership,
        priority || "",
        jobId || "",
      ] as const,
    jobById: (id: string) => ["board", "job", id] as const,
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
  foremen: ["users", "foremen"] as const,
  backups: {
    all: ["job-backups"] as const,
    list: (includeUndone: boolean) =>
      ["job-backups", { includeUndone }] as const,
  },
};
