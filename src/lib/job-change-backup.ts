import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import ExcelJS from "exceljs";
import type {
  AuditActor,
  Job,
  JobAssignee,
  JobHandover,
  JobPartLoan,
  JobStep,
  Technician,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
export const BACKUP_JOBS_PATH = path.join(DATA_DIR, "backup-jobs.xlsx");

const SHEET = "ChangeLog";

const HEADERS = [
  "id",
  "at",
  "user_id",
  "user_name",
  "user_level",
  "action",
  "entity",
  "entity_id",
  "job_id",
  "summary",
  "before_json",
  "after_json",
  "undone",
  "undone_at",
  "undone_by_user_id",
  "undone_by_user_name",
  "undone_by_user_level",
] as const;

/** Snapshot of job-related rows for undo. */
export type JobChangeBundle = {
  job?: Job | null;
  steps?: JobStep[];
  assignees?: JobAssignee[];
  handovers?: JobHandover[];
  part_loans?: JobPartLoan[];
  handover?: JobHandover | null;
  part_loan?: JobPartLoan | null;
  /** Technician status/current_job_id before/after assign or progress. */
  technicians?: Array<Pick<Technician, "id" | "status" | "current_job_id">>;
  /** Extra meta e.g. archived path */
  meta?: Record<string, string | boolean | number | null>;
};

export type JobChangeBackupEntry = {
  id: string;
  at: string;
  user_id: string;
  user_name: string;
  user_level: string;
  action: string;
  entity: string;
  entity_id: string;
  job_id: string;
  summary: string;
  before_json: string;
  after_json: string;
  undone: "0" | "1";
  undone_at: string;
  undone_by_user_id: string;
  undone_by_user_name: string;
  undone_by_user_level: string;
};

export type JobChangeBackupInput = {
  action: string;
  entity: string;
  entity_id: string;
  job_id: string;
  summary: string;
  before: JobChangeBundle | null;
  after: JobChangeBundle | null;
  actor?: AuditActor | null;
  at?: string;
};

type Row = Record<string, string | number>;

let backupQueue: Promise<unknown> = Promise.resolve();

function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = backupQueue.then(fn, fn);
  backupQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cellStr(v: ExcelJS.CellValue | undefined): string {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String(v.text ?? "");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
}

function writeSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  rows: Row[]
) {
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(name);
  ws.addRow([...headers]);
  for (const r of rows) {
    ws.addRow(headers.map((h) => r[h] ?? ""));
  }
}

function readRows(ws: ExcelJS.Worksheet): Row[] {
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => {
    headers[col] = cellStr(cell.value).trim();
  });
  const rows: Row[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Row = {};
    let empty = true;
    headers.forEach((h, col) => {
      if (!h) return;
      const str = cellStr(row.getCell(col).value);
      if (str !== "") empty = false;
      obj[h] = str;
    });
    if (!empty) rows.push(obj);
  });
  return rows;
}

async function atomicWrite(wb: ExcelJS.Workbook) {
  ensureDataDir();
  const tmp = `${BACKUP_JOBS_PATH}.${process.pid}.tmp`;
  await wb.xlsx.writeFile(tmp);
  try {
    if (fs.existsSync(BACKUP_JOBS_PATH)) fs.unlinkSync(BACKUP_JOBS_PATH);
    fs.renameSync(tmp, BACKUP_JOBS_PATH);
  } catch {
    fs.copyFileSync(tmp, BACKUP_JOBS_PATH);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

async function loadBackupWorkbook(): Promise<ExcelJS.Workbook> {
  ensureDataDir();
  const wb = new ExcelJS.Workbook();
  if (!fs.existsSync(BACKUP_JOBS_PATH)) {
    writeSheet(wb, SHEET, HEADERS, []);
    await atomicWrite(wb);
    return wb;
  }
  await wb.xlsx.readFile(BACKUP_JOBS_PATH);
  if (!wb.getWorksheet(SHEET)) {
    writeSheet(wb, SHEET, HEADERS, []);
  }
  return wb;
}

function mapEntry(r: Row): JobChangeBackupEntry {
  return {
    id: String(r.id || ""),
    at: String(r.at || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    user_level: String(r.user_level || ""),
    action: String(r.action || ""),
    entity: String(r.entity || ""),
    entity_id: String(r.entity_id || ""),
    job_id: String(r.job_id || ""),
    summary: String(r.summary || ""),
    before_json: String(r.before_json || ""),
    after_json: String(r.after_json || ""),
    undone: String(r.undone || "0") === "1" ? "1" : "0",
    undone_at: String(r.undone_at || ""),
    undone_by_user_id: String(r.undone_by_user_id || ""),
    undone_by_user_name: String(r.undone_by_user_name || ""),
    undone_by_user_level: String(r.undone_by_user_level || ""),
  };
}

function entryToRow(e: JobChangeBackupEntry): Row {
  return { ...e };
}

export function serializeBundle(bundle: JobChangeBundle | null): string {
  if (!bundle) return "";
  return JSON.stringify(bundle);
}

export function parseBundle(raw: string): JobChangeBundle | null {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as JobChangeBundle;
  } catch {
    return null;
  }
}

/** Append one change snapshot to data/backup-jobs.xlsx (ChangeLog). */
export async function appendJobChangeBackup(
  input: JobChangeBackupInput
): Promise<JobChangeBackupEntry> {
  return withBackupLock(async () => {
    const wb = await loadBackupWorkbook();
    const ws = wb.getWorksheet(SHEET) ?? wb.addWorksheet(SHEET);
    const rows = readRows(ws).map(mapEntry);
    const at = input.at || new Date().toISOString();
    const entry: JobChangeBackupEntry = {
      id: uuidv4(),
      at,
      user_id: input.actor?.user_id || "",
      user_name: input.actor?.user_name || "",
      user_level: input.actor?.user_level || "",
      action: input.action,
      entity: input.entity,
      entity_id: input.entity_id,
      job_id: input.job_id,
      summary: input.summary,
      before_json: serializeBundle(input.before),
      after_json: serializeBundle(input.after),
      undone: "0",
      undone_at: "",
      undone_by_user_id: "",
      undone_by_user_name: "",
      undone_by_user_level: "",
    };
    rows.push(entry);
    writeSheet(
      wb,
      SHEET,
      HEADERS,
      rows.map(entryToRow)
    );
    await atomicWrite(wb);
    return entry;
  });
}

export async function listJobChangeBackups(opts?: {
  limit?: number;
  jobId?: string;
  includeUndone?: boolean;
}): Promise<JobChangeBackupEntry[]> {
  return withBackupLock(async () => {
    const wb = await loadBackupWorkbook();
    const ws = wb.getWorksheet(SHEET);
    if (!ws) return [];
    let rows = readRows(ws).map(mapEntry);
    if (opts?.jobId) {
      rows = rows.filter((r) => r.job_id === opts.jobId);
    }
    if (!opts?.includeUndone) {
      rows = rows.filter((r) => r.undone !== "1");
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    return rows.slice(0, limit);
  });
}

export async function getJobChangeBackup(
  id: string
): Promise<JobChangeBackupEntry | null> {
  return withBackupLock(async () => {
    const wb = await loadBackupWorkbook();
    const ws = wb.getWorksheet(SHEET);
    if (!ws) return null;
    return readRows(ws).map(mapEntry).find((r) => r.id === id) || null;
  });
}

export async function markJobChangeBackupUndone(
  id: string,
  actor?: AuditActor | null
): Promise<JobChangeBackupEntry> {
  return withBackupLock(async () => {
    const wb = await loadBackupWorkbook();
    const ws = wb.getWorksheet(SHEET);
    if (!ws) throw new Error("backup-jobs.xlsx kosong");
    const rows = readRows(ws).map(mapEntry);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("Entri backup tidak ditemukan");
    if (row.undone === "1") throw new Error("Entri backup sudah di-undo");
    const at = new Date().toISOString();
    row.undone = "1";
    row.undone_at = at;
    row.undone_by_user_id = actor?.user_id || "";
    row.undone_by_user_name = actor?.user_name || "";
    row.undone_by_user_level = actor?.user_level || "";
    writeSheet(
      wb,
      SHEET,
      HEADERS,
      rows.map(entryToRow)
    );
    await atomicWrite(wb);
    return row;
  });
}

/** Pick tech fields relevant for restore. */
export function techSnap(
  techs: Technician[],
  ids: string[]
): JobChangeBundle["technicians"] {
  const set = new Set(ids);
  return techs
    .filter((t) => set.has(t.id))
    .map((t) => ({
      id: t.id,
      status: t.status,
      current_job_id: t.current_job_id,
    }));
}
