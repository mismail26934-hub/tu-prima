import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { broadcastDashboardChanged } from "./realtime/hub";
import {
  DEFAULT_JOB_PRIORITIES,
  normalizeJobPriority,
  type JobPriorityRecord,
} from "./types";

let cache: JobPriorityRecord[] | null = null;
let loadPromise: Promise<JobPriorityRecord[]> | null = null;

export function clearJobPriorityCache() {
  cache = null;
  loadPromise = null;
}

function mapRow(row: mysql.RowDataPacket): JobPriorityRecord {
  return {
    id: String(row.id || ""),
    code: normalizeJobPriority(row.code),
    name: String(row.name || "").trim() || String(row.code || "").trim(),
    sort_order: Number(row.sort_order) || 0,
    active: Number(row.active) === 0 ? "0" : "1",
  };
}

function sortRows(rows: JobPriorityRecord[]): JobPriorityRecord[] {
  return [...rows].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.code.localeCompare(b.code);
  });
}

async function fetchAllFromDb(): Promise<JobPriorityRecord[]> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, code, name, sort_order, active
     FROM job_priorities
     ORDER BY sort_order ASC, code ASC`
  );
  return sortRows(rows.map(mapRow).filter((row) => row.id && row.code));
}

async function loadCatalog(): Promise<JobPriorityRecord[]> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      cache = await fetchAllFromDb();
      return cache;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function newPriorityId(): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `JP-${rand}`;
}

export async function ensureJobPrioritiesSeeded(): Promise<void> {
  const p = getPool();
  for (const row of DEFAULT_JOB_PRIORITIES) {
    await p.query(
      `INSERT INTO job_priorities (id, code, name, sort_order, active)
       SELECT ?, ?, ?, ?, 1 FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM job_priorities WHERE code = ?
       )`,
      [row.id, row.code, row.name, row.sort_order, row.code]
    );
  }
  clearJobPriorityCache();
}

export async function listJobPriorities(opts?: {
  includeInactive?: boolean;
}): Promise<JobPriorityRecord[]> {
  const rows = await loadCatalog();
  if (opts?.includeInactive) return rows;
  return rows.filter((row) => row.active === "1");
}

export async function getJobPriority(id: string): Promise<JobPriorityRecord | null> {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const rows = await loadCatalog();
  return rows.find((row) => row.id === wanted) || null;
}

export async function getJobPriorityByCode(
  code: string
): Promise<JobPriorityRecord | null> {
  const wanted = normalizeJobPriority(code);
  if (!wanted) return null;
  const rows = await loadCatalog();
  return rows.find((row) => row.code === wanted) || null;
}

export async function assertJobPriorityForWrite(
  raw: unknown,
  previous?: string
): Promise<string> {
  const code = normalizeJobPriority(raw);
  if (!code) return "";
  const prev = normalizeJobPriority(previous);
  if (prev && code === prev) return code;
  const found = await getJobPriorityByCode(code);
  if (!found) throw new Error("Prioritas tidak ditemukan");
  if (found.active !== "1") throw new Error("Prioritas nonaktif");
  return code;
}

async function nextSortOrder(): Promise<number> {
  const rows = await loadCatalog();
  if (!rows.length) return 10;
  return Math.max(...rows.map((row) => row.sort_order)) + 10;
}

async function persist(row: JobPriorityRecord): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO job_priorities (id, code, name, sort_order, active)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       sort_order = VALUES(sort_order),
       active = VALUES(active)`,
    [row.id, row.code, row.name, row.sort_order, row.active === "0" ? 0 : 1]
  );
  clearJobPriorityCache();
  broadcastDashboardChanged();
}

export async function createJobPriority(input: {
  code: string;
  name: string;
  sort_order?: number;
  active?: string;
  id?: string;
}): Promise<JobPriorityRecord> {
  const code = normalizeJobPriority(input.code);
  const name = String(input.name || "").trim() || code;
  if (!code) throw new Error("Kode prioritas wajib diisi");
  const existing = await loadCatalog();
  if (existing.some((row) => row.code === code)) {
    throw new Error("Kode prioritas sudah dipakai");
  }
  const sort_order =
    Number.isFinite(Number(input.sort_order)) && Number(input.sort_order) > 0
      ? Math.round(Number(input.sort_order))
      : await nextSortOrder();
  const row: JobPriorityRecord = {
    id: String(input.id || "").trim() || newPriorityId(),
    code,
    name,
    sort_order,
    active: String(input.active ?? "1").trim() === "0" ? "0" : "1",
  };
  await persist(row);
  return row;
}

export async function updateJobPriority(
  id: string,
  input: {
    name?: string;
    sort_order?: number;
    active?: string;
  }
): Promise<JobPriorityRecord> {
  const current = await getJobPriority(id);
  if (!current) throw new Error("Prioritas tidak ditemukan");
  const name = input.name != null ? String(input.name).trim() : current.name;
  if (!name) throw new Error("Nama prioritas wajib diisi");
  const sort_order =
    input.sort_order != null && Number.isFinite(Number(input.sort_order))
      ? Math.round(Number(input.sort_order))
      : current.sort_order;
  const row: JobPriorityRecord = {
    ...current,
    name,
    sort_order,
    active:
      input.active != null
        ? String(input.active).trim() === "0"
          ? "0"
          : "1"
        : current.active,
  };
  await persist(row);
  return row;
}

export async function deleteJobPriority(id: string): Promise<{ ok: true }> {
  const current = await getJobPriority(id);
  if (!current) throw new Error("Prioritas tidak ditemukan");
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE UPPER(priority) = ?`,
    [current.code]
  );
  const used = Number(rows[0]?.cnt) || 0;
  if (used > 0) {
    throw new Error(
      "Prioritas masih dipakai job — nonaktifkan lewat Edit jika perlu"
    );
  }
  await p.query(`DELETE FROM job_priorities WHERE id = ?`, [current.id]);
  clearJobPriorityCache();
  broadcastDashboardChanged();
  return { ok: true };
}
