import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { broadcastDashboardChanged } from "./realtime/hub";
import type { Shift } from "./types";

let cache: Shift[] | null = null;
let loadPromise: Promise<Shift[]> | null = null;

export function clearShiftCache() {
  cache = null;
  loadPromise = null;
}

export function shiftLabel(s: Pick<Shift, "name" | "code">): string {
  const name = String(s.name || "").trim();
  if (name) return name;
  return String(s.code || "").trim();
}

function mapRow(row: mysql.RowDataPacket): Shift {
  return {
    id: String(row.id || ""),
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    active: Number(row.active) === 0 ? "0" : "1",
  };
}

function sortRows(rows: Shift[]): Shift[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllFromDb(): Promise<Shift[]> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, code, name, active
     FROM shifts
     ORDER BY name ASC`
  );
  return sortRows(rows.map(mapRow).filter((row) => row.id));
}

async function loadCatalog(): Promise<Shift[]> {
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

function newShiftId(): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `SH-${rand}`;
}

/** Internal unique key derived from name (column `code` kept for DB uniqueness). */
function codeFromName(name: string, id: string): string {
  const base = String(name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);
  return base || id;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function listShifts(opts?: {
  includeInactive?: boolean;
}): Promise<Shift[]> {
  const rows = await loadCatalog();
  if (opts?.includeInactive) return rows;
  return rows.filter((row) => row.active === "1");
}

export async function getShift(id: string): Promise<Shift | null> {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const rows = await loadCatalog();
  return rows.find((row) => row.id === wanted) || null;
}

async function persist(row: Shift): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO shifts (id, code, name, active)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       active = VALUES(active)`,
    [row.id, row.code, row.name, row.active === "0" ? 0 : 1]
  );
  clearShiftCache();
  broadcastDashboardChanged();
}

export async function createShift(input: {
  name: string;
  active?: string;
  id?: string;
}): Promise<Shift> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nama shift wajib diisi");
  const existing = await loadCatalog();
  if (existing.some((row) => sameName(row.name, name))) {
    throw new Error("Nama shift sudah dipakai");
  }
  const id = String(input.id || "").trim() || newShiftId();
  let code = codeFromName(name, id);
  if (existing.some((row) => row.code === code)) {
    code = `${code}-${id.slice(-6)}`.slice(0, 64);
  }
  const row: Shift = {
    id,
    code,
    name,
    active: String(input.active ?? "1").trim() === "0" ? "0" : "1",
  };
  await persist(row);
  return row;
}

export async function updateShift(
  id: string,
  input: {
    name?: string;
    active?: string;
  }
): Promise<Shift> {
  const current = await getShift(id);
  if (!current) throw new Error("Shift tidak ditemukan");
  const name =
    input.name != null ? String(input.name).trim() : current.name;
  if (!name) throw new Error("Nama shift wajib diisi");
  const existing = await loadCatalog();
  if (
    existing.some(
      (row) => row.id !== current.id && sameName(row.name, name)
    )
  ) {
    throw new Error("Nama shift sudah dipakai");
  }
  let code = codeFromName(name, current.id);
  if (
    existing.some((row) => row.code === code && row.id !== current.id)
  ) {
    code = `${code}-${current.id.slice(-6)}`.slice(0, 64);
  }
  const row: Shift = {
    ...current,
    code,
    name,
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

export async function deleteShift(id: string): Promise<{ ok: true }> {
  const current = await getShift(id);
  if (!current) throw new Error("Shift tidak ditemukan");
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM users WHERE shift_id = ?`,
    [current.id]
  );
  const used = Number(rows[0]?.cnt) || 0;
  if (used > 0) {
    throw new Error(
      "Shift masih dipakai user — nonaktifkan lewat Edit jika perlu"
    );
  }
  await p.query(`DELETE FROM shifts WHERE id = ?`, [current.id]);
  clearShiftCache();
  broadcastDashboardChanged();
  return { ok: true };
}
