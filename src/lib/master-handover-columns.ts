export const MASTER_HANDOVER_COLUMN_IDS = [
  "no",
  "unitNo",
  "unitIn",
  "customer",
  "description",
  "shiftDate",
  "from",
  "to",
  "progress",
  "handover",
  "prevMp",
  "planMp",
  "done",
  "actions",
] as const;

export type MasterHandoverColumnId =
  (typeof MASTER_HANDOVER_COLUMN_IDS)[number];

export type MasterHandoverColumnDef = {
  id: MasterHandoverColumnId;
  /** Approx width for sticky left offsets (px). */
  width: number;
  /** Cannot be hidden. */
  required?: boolean;
  /** Job-level cell (repeated on empty + data rows). */
  kind: "job" | "handover" | "actions";
  thClassName?: string;
  tdClassName?: string;
};

export const MASTER_HANDOVER_COLUMN_DEFS: Record<
  MasterHandoverColumnId,
  MasterHandoverColumnDef
> = {
  no: {
    id: "no",
    width: 48,
    required: true,
    kind: "job",
    thClassName: "col-no",
    tdClassName: "col-no",
  },
  unitNo: { id: "unitNo", width: 88, kind: "job" },
  unitIn: { id: "unitIn", width: 132, kind: "job" },
  customer: { id: "customer", width: 180, kind: "job" },
  description: { id: "description", width: 200, kind: "job" },
  shiftDate: { id: "shiftDate", width: 110, kind: "handover" },
  from: { id: "from", width: 110, kind: "handover" },
  to: { id: "to", width: 120, kind: "handover" },
  progress: {
    id: "progress",
    width: 220,
    kind: "handover",
    tdClassName: "master-handover-multiline",
  },
  handover: {
    id: "handover",
    width: 220,
    kind: "handover",
    tdClassName: "master-handover-multiline",
  },
  prevMp: {
    id: "prevMp",
    width: 140,
    kind: "handover",
    tdClassName: "master-handover-mp",
  },
  planMp: {
    id: "planMp",
    width: 140,
    kind: "handover",
    tdClassName: "master-handover-mp",
  },
  done: {
    id: "done",
    width: 64,
    kind: "handover",
    thClassName: "col-done",
    tdClassName: "col-done",
  },
  actions: {
    id: "actions",
    width: 120,
    required: true,
    kind: "actions",
    thClassName: "col-act",
    tdClassName: "col-act",
  },
};

export type MasterHandoverColumnPrefs = {
  order: MasterHandoverColumnId[];
  hidden: MasterHandoverColumnId[];
  frozen: MasterHandoverColumnId[];
};

export const DEFAULT_MASTER_HANDOVER_COLUMN_PREFS: MasterHandoverColumnPrefs = {
  order: [...MASTER_HANDOVER_COLUMN_IDS],
  hidden: [],
  frozen: ["no", "unitNo"],
};

export function normalizeMasterHandoverColumnPrefs(
  raw: Partial<MasterHandoverColumnPrefs> | null | undefined
): MasterHandoverColumnPrefs {
  const known = new Set(MASTER_HANDOVER_COLUMN_IDS);
  const orderIn = Array.isArray(raw?.order) ? raw!.order : [];
  const order: MasterHandoverColumnId[] = [];
  for (const id of orderIn) {
    if (known.has(id as MasterHandoverColumnId) && !order.includes(id as MasterHandoverColumnId)) {
      order.push(id as MasterHandoverColumnId);
    }
  }
  for (const id of MASTER_HANDOVER_COLUMN_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  const hidden = (Array.isArray(raw?.hidden) ? raw!.hidden : [])
    .filter((id): id is MasterHandoverColumnId => known.has(id as MasterHandoverColumnId))
    .filter((id) => !MASTER_HANDOVER_COLUMN_DEFS[id].required);

  const frozen = (Array.isArray(raw?.frozen) ? raw!.frozen : [])
    .filter((id): id is MasterHandoverColumnId => known.has(id as MasterHandoverColumnId));

  return { order, hidden, frozen };
}

/** Visible columns: frozen block first (stable order), then the rest. */
export function resolveMasterHandoverDisplayColumns(
  prefs: MasterHandoverColumnPrefs
): {
  columns: MasterHandoverColumnDef[];
  frozenIds: MasterHandoverColumnId[];
} {
  const hidden = new Set(prefs.hidden);
  const frozen = new Set(prefs.frozen);
  const visible = prefs.order.filter((id) => !hidden.has(id));
  const frozenIds = visible.filter((id) => frozen.has(id));
  const scrollCols = visible.filter((id) => !frozen.has(id));
  const displayIds = [...frozenIds, ...scrollCols];

  return {
    columns: displayIds.map((id) => MASTER_HANDOVER_COLUMN_DEFS[id]),
    frozenIds,
  };
}

/** Build sticky `left` from measured header cell widths (px). */
export function stickyLeftFromWidths(
  frozenIds: MasterHandoverColumnId[],
  widths: Partial<Record<MasterHandoverColumnId, number>>
): Partial<Record<MasterHandoverColumnId, number>> {
  const stickyLeft: Partial<Record<MasterHandoverColumnId, number>> = {};
  let left = 0;
  for (const id of frozenIds) {
    stickyLeft[id] = left;
    const measured = widths[id];
    const fallback = MASTER_HANDOVER_COLUMN_DEFS[id].width;
    left += measured && measured > 0 ? measured : fallback;
  }
  return stickyLeft;
}
