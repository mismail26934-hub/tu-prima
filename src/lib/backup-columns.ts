export const BACKUP_COLUMN_IDS = [
  "waktu",
  "aksi",
  "jenis",
  "data",
  "pengguna",
  "isi",
] as const;

export type BackupColumnId = (typeof BACKUP_COLUMN_IDS)[number];

export type BackupColumnDef = {
  id: BackupColumnId;
  /** Approx width for sticky left offsets (px). */
  width: number;
  /** Cannot be hidden. */
  required?: boolean;
  thClassName?: string;
  tdClassName?: string;
  label: string;
};

export const BACKUP_COLUMN_DEFS: Record<BackupColumnId, BackupColumnDef> = {
  waktu: { id: "waktu", width: 140, label: "Waktu" },
  aksi: { id: "aksi", width: 100, label: "Aksi" },
  jenis: { id: "jenis", width: 110, label: "Jenis" },
  data: { id: "data", width: 200, label: "Data" },
  pengguna: { id: "pengguna", width: 160, label: "Pengguna" },
  isi: {
    id: "isi",
    width: 90,
    required: true,
    label: "Isi",
    thClassName: "col-act",
    tdClassName: "col-act",
  },
};

export type BackupColumnPrefs = {
  order: BackupColumnId[];
  hidden: BackupColumnId[];
  frozen: BackupColumnId[];
};

export const DEFAULT_BACKUP_COLUMN_PREFS: BackupColumnPrefs = {
  order: [...BACKUP_COLUMN_IDS],
  hidden: [],
  frozen: ["waktu"],
};

export function normalizeBackupColumnPrefs(
  raw: Partial<BackupColumnPrefs> | null | undefined
): BackupColumnPrefs {
  const known = new Set(BACKUP_COLUMN_IDS);
  const orderIn = Array.isArray(raw?.order) ? raw!.order : [];
  const order: BackupColumnId[] = [];
  for (const id of orderIn) {
    if (known.has(id as BackupColumnId) && !order.includes(id as BackupColumnId)) {
      order.push(id as BackupColumnId);
    }
  }
  for (const id of BACKUP_COLUMN_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  const hidden = (Array.isArray(raw?.hidden) ? raw!.hidden : [])
    .filter((id): id is BackupColumnId => known.has(id as BackupColumnId))
    .filter((id) => !BACKUP_COLUMN_DEFS[id].required);

  const frozen = (Array.isArray(raw?.frozen) ? raw!.frozen : []).filter(
    (id): id is BackupColumnId => known.has(id as BackupColumnId)
  );

  return { order, hidden, frozen };
}

/** Visible columns: frozen block first (stable order), then the rest. */
export function resolveBackupDisplayColumns(prefs: BackupColumnPrefs): {
  columns: BackupColumnDef[];
  frozenIds: BackupColumnId[];
} {
  const hidden = new Set(prefs.hidden);
  const frozen = new Set(prefs.frozen);
  const visible = prefs.order.filter((id) => !hidden.has(id));
  const frozenIds = visible.filter((id) => frozen.has(id));
  const scrollCols = visible.filter((id) => !frozen.has(id));
  const displayIds = [...frozenIds, ...scrollCols];

  return {
    columns: displayIds.map((id) => BACKUP_COLUMN_DEFS[id]),
    frozenIds,
  };
}

/** Build sticky `left` from measured header cell widths (px). */
export function stickyLeftFromWidths(
  frozenIds: BackupColumnId[],
  widths: Partial<Record<BackupColumnId, number>>
): Partial<Record<BackupColumnId, number>> {
  const stickyLeft: Partial<Record<BackupColumnId, number>> = {};
  let left = 0;
  for (const id of frozenIds) {
    stickyLeft[id] = left;
    const measured = widths[id];
    const fallback = BACKUP_COLUMN_DEFS[id].width;
    left += measured && measured > 0 ? measured : fallback;
  }
  return stickyLeft;
}
