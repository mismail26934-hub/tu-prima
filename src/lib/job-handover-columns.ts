export const JOB_HANDOVER_COLUMN_IDS = [
  "actions",
  "no",
  "shiftDate",
  "from",
  "to",
  "progress",
  "handover",
  "prevMp",
  "planMp",
  "done",
] as const;

export type JobHandoverColumnId = (typeof JOB_HANDOVER_COLUMN_IDS)[number];

export type JobHandoverColumnDef = {
  id: JobHandoverColumnId;
  /** Approx width for sticky left offsets (px). */
  width: number;
  /** Cannot be hidden. */
  required?: boolean;
  thClassName?: string;
  tdClassName?: string;
};

export const JOB_HANDOVER_COLUMN_DEFS: Record<
  JobHandoverColumnId,
  JobHandoverColumnDef
> = {
  no: {
    id: "no",
    width: 48,
    required: true,
    thClassName: "col-no",
    tdClassName: "col-no",
  },
  shiftDate: { id: "shiftDate", width: 120 },
  from: { id: "from", width: 120 },
  to: { id: "to", width: 140 },
  progress: {
    id: "progress",
    width: 220,
    tdClassName: "job-handover-multiline",
  },
  handover: {
    id: "handover",
    width: 220,
    tdClassName: "job-handover-multiline",
  },
  prevMp: {
    id: "prevMp",
    width: 140,
    tdClassName: "job-handover-mp",
  },
  planMp: {
    id: "planMp",
    width: 140,
    tdClassName: "job-handover-mp",
  },
  done: {
    id: "done",
    width: 64,
    thClassName: "col-done",
    tdClassName: "col-done",
  },
  actions: {
    id: "actions",
    width: 100,
    required: true,
    thClassName: "col-act",
    tdClassName: "col-act",
  },
};

export type JobHandoverColumnPrefs = {
  order: JobHandoverColumnId[];
  hidden: JobHandoverColumnId[];
  frozen: JobHandoverColumnId[];
};

export const DEFAULT_JOB_HANDOVER_COLUMN_PREFS: JobHandoverColumnPrefs = {
  order: [...JOB_HANDOVER_COLUMN_IDS],
  hidden: [],
  frozen: ["actions", "no"],
};

export function normalizeJobHandoverColumnPrefs(
  raw: Partial<JobHandoverColumnPrefs> | null | undefined
): JobHandoverColumnPrefs {
  const known = new Set(JOB_HANDOVER_COLUMN_IDS);
  const orderIn = Array.isArray(raw?.order) ? raw!.order : [];
  const order: JobHandoverColumnId[] = [];
  for (const id of orderIn) {
    if (
      known.has(id as JobHandoverColumnId) &&
      !order.includes(id as JobHandoverColumnId)
    ) {
      order.push(id as JobHandoverColumnId);
    }
  }
  for (const id of JOB_HANDOVER_COLUMN_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  const hidden = (Array.isArray(raw?.hidden) ? raw!.hidden : [])
    .filter((id): id is JobHandoverColumnId =>
      known.has(id as JobHandoverColumnId)
    )
    .filter((id) => !JOB_HANDOVER_COLUMN_DEFS[id].required);

  const frozen = (Array.isArray(raw?.frozen) ? raw!.frozen : []).filter(
    (id): id is JobHandoverColumnId => known.has(id as JobHandoverColumnId)
  );

  return { order, hidden, frozen };
}

/** Visible columns: frozen block first (stable order), then the rest. */
export function resolveJobHandoverDisplayColumns(
  prefs: JobHandoverColumnPrefs,
  options?: { includeActions?: boolean }
): {
  columns: JobHandoverColumnDef[];
  frozenIds: JobHandoverColumnId[];
} {
  const hidden = new Set(prefs.hidden);
  const frozen = new Set(prefs.frozen);
  const includeActions = options?.includeActions !== false;
  const visible = prefs.order.filter((id) => {
    if (!includeActions && id === "actions") return false;
    return !hidden.has(id);
  });
  const frozenIds = visible.filter((id) => frozen.has(id));
  const scrollCols = visible.filter((id) => !frozen.has(id));
  const displayIds = [...frozenIds, ...scrollCols];

  return {
    columns: displayIds.map((id) => JOB_HANDOVER_COLUMN_DEFS[id]),
    frozenIds,
  };
}

/** Build sticky `left` from measured header cell widths (px). */
export function stickyLeftFromWidths(
  frozenIds: JobHandoverColumnId[],
  widths: Partial<Record<JobHandoverColumnId, number>>
): Partial<Record<JobHandoverColumnId, number>> {
  const stickyLeft: Partial<Record<JobHandoverColumnId, number>> = {};
  let left = 0;
  for (const id of frozenIds) {
    stickyLeft[id] = left;
    const measured = widths[id];
    const fallback = JOB_HANDOVER_COLUMN_DEFS[id].width;
    left += measured && measured > 0 ? measured : fallback;
  }
  return stickyLeft;
}
