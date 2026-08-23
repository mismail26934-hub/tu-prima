import ExcelJS from "exceljs";
import { v4 as uuidv4 } from "uuid";
import type {
  Job,
  JobAssignee,
  JobEvent,
  JobEventType,
  JobStep,
  JobStatus,
  JobWithDetails,
  StepStatus,
  Technician,
  TechnicianStatus,
  Unit,
  Attendance,
  AttendanceStatus,
  AppUser,
  AppUserPublic,
  DashboardData,
  UserLevel,
  AuditActor,
  AuditLogEntry,
  JobHandover,
  JobPartLoan,
  PartLoanStatus,
} from "./types";
import { USER_LEVELS } from "./types";
import { calcElapsedSec, calcProgressPct, clientTimeIso, nowIso } from "./duration";
import { broadcastDashboardChanged } from "./realtime/hub";
import {
  appendJobChangeBackup,
  getJobChangeBackup,
  markJobChangeBackupUndone,
  parseBundle,
  techSnap,
  type JobChangeBundle,
} from "./job-change-backup";
import {
  getJobTemplate,
  stepsFromTemplate,
} from "./job-templates";
import { archiveDeletedJob } from "./job-delete-archive";
import {
  archiveCompletedJob,
  listCompletedJobDetails,
  takeCompletedJobFromArchive,
} from "./job-completed-archive";
import {
  archiveCancelledJob,
  listCancelledJobDetails,
  takeCancelledJobFromArchive,
} from "./job-cancelled-archive";
import {
  loadMysqlWorkbook,
  saveMysqlWorkbook,
  workbookHasData,
  readMysqlRows,
  writeMysqlSheet,
  MysqlWorkbook,
  MysqlSheet,
  type DbRow,
} from "@/db/mysql-workbook";
import {
  hashPassword,
  needsPasswordHash,
  verifyPassword,
} from "./password";

/** Runtime DB workbook name in MySQL (replaces data/workshop.xlsx). */
const WORKSHOP_DB = "workshop";

const SHEETS = {
  technicians: "Technicians",
  units: "Units",
  jobs: "Jobs",
  assignees: "JobAssignees",
  steps: "JobSteps",
  events: "JobEvents",
  attendance: "Attendance",
  users: "Users",
  audit: "AuditLog",
  handovers: "JobHandovers",
  partLoans: "JobPartLoans",
} as const;

type Row = DbRow;

/** Serialize all DB read/write to avoid concurrent mutation races. */
let dbQueue: Promise<unknown> = Promise.resolve();

function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbQueue.then(fn, fn);
  dbQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function cellStr(v: ExcelJS.CellValue | string | number | undefined): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // Badge / Pernr / SN from Excel often arrive as numbers (avoid "57246.0")
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) {
      return String(Math.round(v));
    }
    return String(v);
  }
  if (typeof v === "object" && "text" in v) return String(v.text ?? "");
  if (typeof v === "object" && "result" in v) return cellStr(v.result as ExcelJS.CellValue);
  return String(v);
}

/** Header aliases: No. ID Badge = Pernr / SN (confirmed mapping). */
const TECH_SN_HEADERS = [
  "no. id badge",
  "no id badge",
  "id badge",
  "badge",
  "sn",
  "sn kpc",
  "skill",
  "pernr",
  "nik",
  "kpc",
] as const;

const TECH_NAME_HEADERS = [
  "nama karyawan",
  "name employee",
  "name",
  "nama",
] as const;

function findSheetHeader(
  ws: ExcelJS.Worksheet,
  snNames: readonly string[],
  nameNames: readonly string[],
  maxScan = 40
): { headerRow: number; headerMap: Record<string, number> } | null {
  let snOnly: { headerRow: number; headerMap: Record<string, number> } | null =
    null;
  for (let r = 1; r <= Math.min(maxScan, ws.rowCount || maxScan); r++) {
    const headerMap: Record<string, number> = {};
    ws.getRow(r).eachCell((cell, col) => {
      const key = cellStr(cell.value).trim().toLowerCase();
      if (key) headerMap[key] = col;
    });
    const hasSn = snNames.some((n) => headerMap[n]);
    const hasName = nameNames.some((n) => headerMap[n]);
    if (hasSn && hasName) return { headerRow: r, headerMap };
    if (hasSn && !snOnly) snOnly = { headerRow: r, headerMap };
  }
  return snOnly;
}

function headerCol(
  headerMap: Record<string, number>,
  ...names: string[]
): number {
  for (const n of names) {
    const c = headerMap[n.toLowerCase()];
    if (c) return c;
  }
  return 0;
}

/** Collect unique No. ID Badge / Pernr / SN values from a meals or roster workbook. */
function extractPresenceBadgesFromWorkbook(src: ExcelJS.Workbook): {
  badges: Set<string>;
  namesByBadge: Map<string, string>;
  sheetUsed: string;
} {
  const badges = new Set<string>();
  const namesByBadge = new Map<string, string>();
  let sheetUsed = "";

  const sheets = [...src.worksheets].sort((a, b) => {
    const score = (n: string) => {
      const x = n.toLowerCase();
      if (x.includes("formula")) return 0;
      if (x.includes("regular") || x.includes("additional")) return 1;
      return 2;
    };
    return score(a.name) - score(b.name);
  });

  for (const ws of sheets) {
    const found = findSheetHeader(ws, TECH_SN_HEADERS, TECH_NAME_HEADERS);
    if (!found) continue;
    if (!sheetUsed) sheetUsed = ws.name;
    const cSn = headerCol(found.headerMap, ...TECH_SN_HEADERS);
    const cName = headerCol(found.headerMap, ...TECH_NAME_HEADERS);
    if (!cSn) continue;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= found.headerRow) return;
      const badge = cellStr(row.getCell(cSn).value).trim();
      if (!badge) return;
      const key = badge.toLowerCase();
      badges.add(key);
      if (cName) {
        const name = cellStr(row.getCell(cName).value).trim();
        if (name && !namesByBadge.has(key)) namesByBadge.set(key, name);
      }
    });
  }

  return { badges, namesByBadge, sheetUsed };
}

async function loadWorkbook(): Promise<MysqlWorkbook> {
  const hasData = await workbookHasData(WORKSHOP_DB);
  if (!hasData) {
    const wb = new MysqlWorkbook(WORKSHOP_DB);
    await createSeedWorkbook(wb);
    await saveMysqlWorkbook(wb);
    return wb;
  }
  return loadMysqlWorkbook(WORKSHOP_DB);
}

async function saveWorkbook(wb: MysqlWorkbook) {
  await saveMysqlWorkbook(wb);
  broadcastDashboardChanged();
}

function getSheet(wb: MysqlWorkbook, name: string): MysqlSheet {
  return wb.getWorksheet(name) ?? wb.addWorksheet(name);
}

function readRows(ws: MysqlSheet): Row[] {
  return readMysqlRows(ws);
}

function writeSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: string[],
  rows: Row[]
) {
  writeMysqlSheet(wb, name, headers, rows);
}

function mapTechnician(r: Row): Technician {
  return {
    id: String(r.id || ""),
    name: String(r.name || ""),
    sn: String(r.sn || r.skill || ""),
    status: String(r.status || "available") as TechnicianStatus,
    current_job_id: String(r.current_job_id || ""),
    phone: String(r.phone || ""),
  };
}

function mapJob(r: Row): Job {
  return {
    id: String(r.id || ""),
    title: String(r.title || ""),
    unit: String(r.unit || ""),
    unit_id: String(r.unit_id || ""),
    description: String(r.description || ""),
    status: String(r.status || "queued") as JobStatus,
    technician_id: String(r.technician_id || ""),
    template_id: String(r.template_id || ""),
    created_at: String(r.created_at || ""),
    started_at: String(r.started_at || ""),
    completed_at: String(r.completed_at || ""),
    paused_at: String(r.paused_at || ""),
    total_paused_sec: Number(r.total_paused_sec || 0),
    estimated_minutes: Number(r.estimated_minutes || 0),
  };
}

function mapUnit(r: Row): Unit {
  return {
    id: String(r.id || ""),
    code: String(r.code || ""),
    name: String(r.name || ""),
    serial_number: String(r.serial_number || ""),
    active: String(r.active || "1") === "0" ? "0" : "1",
  };
}

function mapStep(r: Row): JobStep {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    name: String(r.name || ""),
    order: Number(r.order || 0),
    status: String(r.status || "pending") as StepStatus,
    started_at: String(r.started_at || ""),
    completed_at: String(r.completed_at || ""),
    duration_sec: Number(r.duration_sec || 0),
    std_minutes: Number(r.std_minutes || 0),
  };
}

function mapEvent(r: Row): JobEvent {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    type: String(r.type || "created") as JobEventType,
    note: String(r.note || ""),
    created_at: String(r.created_at || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    user_level: String(r.user_level || ""),
  };
}

function mapAudit(r: Row): AuditLogEntry {
  return {
    id: String(r.id || ""),
    at: String(r.at || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    user_level: String(r.user_level || ""),
    action: String(r.action || ""),
    entity: String(r.entity || ""),
    entity_id: String(r.entity_id || ""),
    detail: String(r.detail || ""),
  };
}

function mapHandover(r: Row): JobHandover {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    order: Number(r.order || 0),
    title: String(r.title || ""),
    done: String(r.done || "0") === "1" ? "1" : "0",
    note: String(r.note || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function mapPartLoan(r: Row): JobPartLoan {
  const raw = String(r.status || "open").trim().toLowerCase();
  const status: PartLoanStatus = raw === "closed" ? "closed" : "open";
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    order: Number(r.order || 0),
    part_name: String(r.part_name || ""),
    status,
    note: String(r.note || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function mapAssignee(r: Row): JobAssignee {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    technician_id: String(r.technician_id || ""),
    assigned_at: String(r.assigned_at || ""),
    is_lead: String(r.is_lead || "0"),
  };
}

function mapAttendance(r: Row): Attendance {
  const status = String(r.status || "alpha") as AttendanceStatus;
  const allowed: AttendanceStatus[] = ["hadir", "izin", "sakit", "off", "alpha"];
  return {
    id: String(r.id || ""),
    date: String(r.date || ""),
    technician_id: String(r.technician_id || ""),
    technician_name: String(r.technician_name || ""),
    pernr: String(r.pernr || ""),
    status: allowed.includes(status) ? status : "alpha",
    dws: String(r.dws || ""),
    check_in: String(r.check_in || ""),
    check_out: String(r.check_out || ""),
    absence: String(r.absence || ""),
    note: String(r.note || ""),
  };
}

function mapUser(r: Row): AppUser {
  const username = String(r.username || "").trim();
  const fallbackLevel: UserLevel =
    String(r.id || "") === "U-admin" || username.toLowerCase() === "admin"
      ? "superuser"
      : "teknisi";
  const rawLevel = String(r.level || fallbackLevel).trim().toLowerCase();
  return {
    id: String(r.id || ""),
    username,
    password: String(r.password || ""),
    name: String(r.name || "").trim(),
    level: USER_LEVELS.includes(rawLevel as UserLevel)
      ? (rawLevel as UserLevel)
      : fallbackLevel,
    active: String(r.active || "1") === "0" ? "0" : "1",
    created_at: String(r.created_at || ""),
  };
}

function userToRow(u: AppUser): Row {
  return { ...u };
}

function toPublicUser(u: AppUser): AppUserPublic {
  const { password: _password, ...rest } = u;
  return rest;
}

function defaultSeedUser(): AppUser {
  const username =
    (typeof process.env.APP_USERNAME === "string" && process.env.APP_USERNAME) ||
    "admin";
  const password =
    (typeof process.env.APP_PASSWORD === "string" && process.env.APP_PASSWORD) ||
    "admin123";
  return {
    id: "U-admin",
    username,
    password,
    name: "Administrator",
    level: "superuser",
    active: "1",
    created_at: nowIso(),
  };
}

function techToRow(t: Technician): Row {
  return { ...t };
}

function jobToRow(j: Job): Row {
  return {
    ...j,
    total_paused_sec: j.total_paused_sec,
    estimated_minutes: j.estimated_minutes,
  };
}

function stepToRow(s: JobStep): Row {
  return {
    ...s,
    order: s.order,
    duration_sec: s.duration_sec,
    std_minutes: Number(s.std_minutes || 0),
  };
}

function handoverToRow(h: JobHandover): Row {
  return { ...h, order: h.order };
}

function partLoanToRow(p: JobPartLoan): Row {
  return { ...p, order: p.order };
}

function eventToRow(e: JobEvent): Row {
  return { ...e };
}

function auditToRow(a: AuditLogEntry): Row {
  return { ...a };
}

function assigneeToRow(a: JobAssignee): Row {
  return { ...a };
}

function unitToRow(u: Unit): Row {
  return { ...u };
}

function attendanceToRow(a: Attendance): Row {
  return { ...a };
}

function unitLabel(u: Unit): string {
  return u.name ? `${u.code} — ${u.name}` : u.code;
}

const TECH_HEADERS = ["id", "name", "sn", "status", "current_job_id", "phone"];
const UNIT_HEADERS = ["id", "code", "name", "serial_number", "active"];
const JOB_HEADERS = [
  "id",
  "title",
  "unit",
  "unit_id",
  "description",
  "status",
  "technician_id",
  "template_id",
  "created_at",
  "started_at",
  "completed_at",
  "paused_at",
  "total_paused_sec",
  "estimated_minutes",
];
const ASSIGNEE_HEADERS = ["id", "job_id", "technician_id", "assigned_at", "is_lead"];
const STEP_HEADERS = [
  "id",
  "job_id",
  "name",
  "order",
  "status",
  "started_at",
  "completed_at",
  "duration_sec",
  "std_minutes",
];
const HANDOVER_HEADERS = [
  "id",
  "job_id",
  "order",
  "title",
  "done",
  "note",
  "user_id",
  "user_name",
  "updated_at",
];
const PART_LOAN_HEADERS = [
  "id",
  "job_id",
  "order",
  "part_name",
  "status",
  "note",
  "user_id",
  "user_name",
  "updated_at",
];
const EVENT_HEADERS = [
  "id",
  "job_id",
  "type",
  "note",
  "created_at",
  "user_id",
  "user_name",
  "user_level",
];
const AUDIT_HEADERS = [
  "id",
  "at",
  "user_id",
  "user_name",
  "user_level",
  "action",
  "entity",
  "entity_id",
  "detail",
];
const ATTENDANCE_HEADERS = [
  "id",
  "date",
  "technician_id",
  "technician_name",
  "pernr",
  "status",
  "dws",
  "check_in",
  "check_out",
  "absence",
  "note",
];
const USER_HEADERS = [
  "id",
  "username",
  "password",
  "name",
  "level",
  "active",
  "created_at",
];

/** Ensure Users sheet exists; seed default admin if empty. Returns true if workbook mutated. */
async function ensureUsers(wb: MysqlWorkbook): Promise<boolean> {
  const existing = readRows(getSheet(wb, SHEETS.users))
    .map(mapUser)
    .filter((u) => u.id && u.username);
  if (existing.length > 0) return false;
  const seed = defaultSeedUser();
  seed.password = await hashPassword(seed.password);
  writeSheet(wb, SHEETS.users, USER_HEADERS, [userToRow(seed)]);
  return true;
}

function readUsers(wb: MysqlWorkbook): AppUser[] {
  return readRows(getSheet(wb, SHEETS.users))
    .map(mapUser)
    .filter((u) => u.id && u.username);
}

/** Rename Technicians.skill → sn in workbook if still on old header. */
function migrateTechnicianSnColumn(wb: MysqlWorkbook): boolean {
  const ws = getSheet(wb, SHEETS.technicians);
  const headerRow = ws.getRow(1);
  let hasSkill = false;
  let hasSn = false;
  headerRow.eachCell((cell) => {
    const h = cellStr(cell.value).trim().toLowerCase();
    if (h === "skill") hasSkill = true;
    if (h === "sn") hasSn = true;
  });
  if (!hasSkill || hasSn) return false;
  const techs = readRows(ws).map(mapTechnician).filter((t) => t.id);
  writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
  return true;
}

/** Ensure Units.serial_number column exists in workbook. */
function migrateUnitSerialNumberColumn(wb: MysqlWorkbook): boolean {
  const ws = getSheet(wb, SHEETS.units);
  const headerRow = ws.getRow(1);
  let hasSerial = false;
  headerRow.eachCell((cell) => {
    const h = cellStr(cell.value).trim().toLowerCase();
    if (h === "serial_number") hasSerial = true;
  });
  if (hasSerial) return false;
  const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
  const units = loadUnits(wb, jobs);
  writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
  return true;
}

/** Ensure JobSteps.std_minutes column; backfill from template when missing. */
function migrateJobStepStdMinutes(
  wb: MysqlWorkbook,
  jobs: Job[],
  steps: JobStep[]
): { steps: JobStep[]; changed: boolean } {
  const ws = getSheet(wb, SHEETS.steps);
  const headerRow = ws.getRow(1);
  let hasStd = false;
  headerRow.eachCell((cell) => {
    if (cellStr(cell.value).trim().toLowerCase() === "std_minutes") {
      hasStd = true;
    }
  });

  let changed = !hasStd;
  const next = steps.map((s) => ({
    ...s,
    std_minutes: Number(s.std_minutes || 0),
  }));

  for (const job of jobs) {
    if (!job.template_id) continue;
    const tpl = getJobTemplate(job.template_id);
    if (!tpl?.steps?.length) continue;
    const tplSteps = tpl.steps.slice().sort((a, b) => a.order - b.order);
    for (const step of next.filter((s) => s.job_id === job.id)) {
      if (step.std_minutes > 0) continue;
      const match =
        tplSteps.find((t) => t.order === step.order) ||
        tplSteps[step.order - 1];
      if (match && Number(match.std_minutes || 0) > 0) {
        step.std_minutes = Number(match.std_minutes);
        changed = true;
      }
    }
  }

  if (changed) {
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, next.map(stepToRow));
  }
  return { steps: next, changed };
}

function loadAuditLog(wb: MysqlWorkbook): AuditLogEntry[] {
  return readRows(getSheet(wb, SHEETS.audit))
    .map(mapAudit)
    .filter((a) => a.id && a.at);
}

function loadHandovers(wb: MysqlWorkbook): JobHandover[] {
  return readRows(getSheet(wb, SHEETS.handovers))
    .map(mapHandover)
    .filter((h) => h.id && h.job_id);
}

function loadPartLoans(wb: MysqlWorkbook): JobPartLoan[] {
  return readRows(getSheet(wb, SHEETS.partLoans))
    .map(mapPartLoan)
    .filter((p) => p.id && p.job_id);
}

function actorSlice(actor?: AuditActor | null): Pick<
  JobEvent,
  "user_id" | "user_name" | "user_level"
> {
  return {
    user_id: actor?.user_id || "",
    user_name: actor?.user_name || "",
    user_level: actor?.user_level || "",
  };
}

function makeJobEvent(
  jobId: string,
  type: JobEventType,
  note: string,
  actor?: AuditActor | null,
  at: string = nowIso()
): JobEvent {
  return {
    id: uuidv4(),
    job_id: jobId,
    type,
    note,
    created_at: at,
    ...actorSlice(actor),
  };
}

function makeAuditEntry(input: {
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  actor?: AuditActor | null;
  at?: string;
}): AuditLogEntry {
  return {
    id: uuidv4(),
    at: input.at || nowIso(),
    user_id: input.actor?.user_id || "",
    user_name: input.actor?.user_name || "",
    user_level: input.actor?.user_level || "",
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id,
    detail: input.detail,
  };
}

function formatActorLabel(actor?: AuditActor | null): string {
  if (!actor?.user_name && !actor?.user_id) return "";
  const who = actor.user_name || actor.user_id;
  return actor.user_level ? `${who} (${actor.user_level})` : who;
}

function buildJobChangeBundle(
  jobId: string,
  jobs: Job[],
  steps: JobStep[],
  assignees: JobAssignee[],
  handovers: JobHandover[],
  partLoans: JobPartLoan[],
  techs?: Technician[],
  extraTechIds: string[] = []
): JobChangeBundle {
  const job = jobs.find((j) => j.id === jobId) || null;
  const asg = assignees.filter((a) => a.job_id === jobId);
  const techIds = [
    ...asg.map((a) => a.technician_id),
    ...(job?.technician_id ? [job.technician_id] : []),
    ...extraTechIds,
  ];
  return {
    job: job ? { ...job } : null,
    steps: steps.filter((s) => s.job_id === jobId).map((s) => ({ ...s })),
    assignees: asg.map((a) => ({ ...a })),
    handovers: handovers.filter((h) => h.job_id === jobId).map((h) => ({ ...h })),
    part_loans: partLoans
      .filter((p) => p.job_id === jobId)
      .map((p) => ({ ...p })),
    technicians: techs ? techSnap(techs, [...new Set(techIds)]) : undefined,
  };
}

/** Ensure JobAssignees exists; migrate from Jobs.technician_id if empty. */
function loadAssignees(
  wb: MysqlWorkbook,
  jobs: Job[]
): JobAssignee[] {
  const ws = getSheet(wb, SHEETS.assignees);
  let assignees = readRows(ws).map(mapAssignee).filter((a) => a.job_id && a.technician_id);
  if (assignees.length === 0) {
    const now = nowIso();
    assignees = jobs
      .filter((j) => j.technician_id)
      .map((j) => ({
        id: uuidv4(),
        job_id: j.id,
        technician_id: j.technician_id,
        assigned_at: j.created_at || now,
        is_lead: "1",
      }));
  }
  return assignees;
}

function assigneesForJob(assignees: JobAssignee[], jobId: string): JobAssignee[] {
  return assignees
    .filter((a) => a.job_id === jobId)
    .sort((a, b) => {
      if (a.is_lead !== b.is_lead) return a.is_lead === "1" ? -1 : 1;
      return a.assigned_at.localeCompare(b.assigned_at);
    });
}

function loadUnits(wb: MysqlWorkbook, jobs: Job[]): Unit[] {
  const ws = getSheet(wb, SHEETS.units);
  let units = readRows(ws).map(mapUnit).filter((u) => u.id && u.code);
  if (units.length === 0) {
    const seen = new Set<string>();
    jobs.forEach((j) => {
      const label = j.unit.trim();
      if (!label || seen.has(label)) return;
      seen.add(label);
      const id = uuidv4();
      units.push({
        id,
        code: label.split(/\s+/)[0] || label,
        name: label,
        serial_number: "",
        active: "1",
      });
      if (!j.unit_id) j.unit_id = id;
    });
  }
  return units;
}

function releaseTechsFromJob(techs: Technician[], jobId: string) {
  techs.forEach((t) => {
    if (t.current_job_id === jobId) {
      t.status = "available";
      t.current_job_id = "";
    }
  });
}
async function createSeedWorkbook(wb: MysqlWorkbook) {
  const now = nowIso();
  const techs: Technician[] = [
    { id: "T01", name: "Andi Pratama", sn: "SN-1001", status: "busy", current_job_id: "J01", phone: "0812-1111-0001" },
    { id: "T02", name: "Budi Santoso", sn: "SN-1002", status: "busy", current_job_id: "J01", phone: "0812-1111-0002" },
    { id: "T03", name: "Citra Dewi", sn: "SN-1003", status: "available", current_job_id: "", phone: "0812-1111-0003" },
    { id: "T04", name: "Dedi Kurnia", sn: "SN-1004", status: "busy", current_job_id: "J02", phone: "0812-1111-0004" },
    { id: "T05", name: "Eko Wijaya", sn: "SN-1005", status: "offline", current_job_id: "", phone: "0812-1111-0005" },
    { id: "T06", name: "Fajar Nugroho", sn: "SN-1006", status: "available", current_job_id: "", phone: "0812-1111-0006" },
  ];

  const started1 = new Date(Date.now() - 85 * 60 * 1000).toISOString();
  const started2 = new Date(Date.now() - 32 * 60 * 1000).toISOString();
  const step2Start = new Date(Date.now() - 40 * 60 * 1000).toISOString();

  const units: Unit[] = [
    { id: "U01", code: "AVZ-1234", name: "Avanza B 1234 ABC", serial_number: "SN-AVZ-1234", active: "1" },
    { id: "U02", code: "INV-5678", name: "Innova D 5678 XYZ", serial_number: "SN-INV-5678", active: "1" },
    { id: "U03", code: "XEN-9012", name: "Xenia F 9012 LMN", serial_number: "SN-XEN-9012", active: "1" },
    { id: "U04", code: "FRT-4455", name: "Fortuner B 4455 QRS", serial_number: "SN-FRT-4455", active: "1" },
    { id: "U05", code: "E448", name: "GOH Unit Rental", serial_number: "SN-E448", active: "1" },
  ];

  const jobs: Job[] = [
    {
      id: "J01",
      title: "Ganti Kampas Rem Depan",
      unit: unitLabel(units[0]),
      unit_id: "U01",
      description: "Rem depan bunyi & jarak rem jauh",
      status: "in_progress",
      technician_id: "T02",
      template_id: "",
      created_at: new Date(Date.now() - 100 * 60 * 1000).toISOString(),
      started_at: started1,
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: 120,
    },
    {
      id: "J02",
      title: "Servis AC Tidak Dingin",
      unit: unitLabel(units[1]),
      unit_id: "U02",
      description: "Isi freon + cek compressor",
      status: "in_progress",
      technician_id: "T04",
      template_id: "",
      created_at: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
      started_at: started2,
      completed_at: "",
      paused_at: "",
      total_paused_sec: 300,
      estimated_minutes: 90,
    },
    {
      id: "J03",
      title: "Tune Up Berkala 40.000 km",
      unit: unitLabel(units[2]),
      unit_id: "U03",
      description: "Ganti oli, filter, busi, cek kelistrikan",
      status: "queued",
      technician_id: "",
      template_id: "",
      created_at: now,
      started_at: "",
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: 150,
    },
    {
      id: "J04",
      title: "Perbaikan Starter Motor",
      unit: unitLabel(units[3]),
      unit_id: "U04",
      description: "Starter sering macet saat dingin",
      status: "queued",
      technician_id: "",
      template_id: "",
      created_at: now,
      started_at: "",
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: 100,
    },
  ];

  const steps: JobStep[] = [
    { id: "S01", job_id: "J01", name: "Diagnosis", order: 1, status: "done", started_at: started1, completed_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(), duration_sec: 900, std_minutes: 30 },
    { id: "S02", job_id: "J01", name: "Bongkar & Ganti Sparepart", order: 2, status: "in_progress", started_at: step2Start, completed_at: "", duration_sec: 0, std_minutes: 60 },
    { id: "S03", job_id: "J01", name: "Pasang & Test Rem", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 20 },
    { id: "S04", job_id: "J01", name: "QC & Serah Terima", order: 4, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 10 },
    { id: "S05", job_id: "J02", name: "Cek Tekanan Freon", order: 1, status: "done", started_at: started2, completed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), duration_sec: 720, std_minutes: 20 },
    { id: "S06", job_id: "J02", name: "Isi Freon / Perbaiki Compressor", order: 2, status: "in_progress", started_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(), completed_at: "", duration_sec: 0, std_minutes: 50 },
    { id: "S07", job_id: "J02", name: "Test Pendinginan", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 20 },
    { id: "S08", job_id: "J03", name: "Ganti Oli & Filter", order: 1, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 40 },
    { id: "S09", job_id: "J03", name: "Ganti Busi", order: 2, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 30 },
    { id: "S10", job_id: "J03", name: "Cek Kelistrikan", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 40 },
    { id: "S11", job_id: "J03", name: "QC Final", order: 4, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 40 },
    { id: "S12", job_id: "J04", name: "Diagnosis Starter", order: 1, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 30 },
    { id: "S13", job_id: "J04", name: "Perbaikan / Ganti", order: 2, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 50 },
    { id: "S14", job_id: "J04", name: "Test Start Engine", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0, std_minutes: 20 },
  ];

  const emptyActor = null;
  const events: JobEvent[] = [
    makeJobEvent("J01", "created", "Job dibuat", emptyActor, jobs[0].created_at),
    makeJobEvent("J01", "assigned", "Diassign ke Andi Pratama, Budi Santoso", emptyActor, jobs[0].created_at),
    makeJobEvent("J01", "started", "Pekerjaan dimulai", emptyActor, started1),
    makeJobEvent("J01", "step_completed", "Diagnosis selesai", emptyActor, steps[0].completed_at),
    makeJobEvent("J01", "step_started", "Bongkar & Ganti Sparepart", emptyActor, step2Start),
    makeJobEvent("J02", "created", "Job dibuat", emptyActor, jobs[1].created_at),
    makeJobEvent("J02", "assigned", "Diassign ke Dedi Kurnia", emptyActor, jobs[1].created_at),
    makeJobEvent("J02", "started", "Pekerjaan dimulai", emptyActor, started2),
    makeJobEvent("J02", "paused", "Tunggu sparepart", emptyActor, new Date(Date.now() - 25 * 60 * 1000).toISOString()),
    makeJobEvent("J02", "resumed", "Lanjut pekerjaan", emptyActor, new Date(Date.now() - 20 * 60 * 1000).toISOString()),
    makeJobEvent("J03", "created", "Job dibuat", emptyActor, now),
    makeJobEvent("J04", "created", "Job dibuat", emptyActor, now),
  ];

  const assignees: JobAssignee[] = [
    { id: uuidv4(), job_id: "J01", technician_id: "T02", assigned_at: jobs[0].created_at, is_lead: "1" },
    { id: uuidv4(), job_id: "J01", technician_id: "T01", assigned_at: jobs[0].created_at, is_lead: "0" },
    { id: uuidv4(), job_id: "J02", technician_id: "T04", assigned_at: jobs[1].created_at, is_lead: "1" },
  ];

  writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
  writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
  writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
  writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
  writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
  writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
  writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, []);
  writeSheet(wb, SHEETS.users, USER_HEADERS, [userToRow(defaultSeedUser())]);
  writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, []);
  writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, []);
  writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, []);
}

function enrichJob(
  job: Job,
  techs: Technician[],
  steps: JobStep[],
  events: JobEvent[],
  assignees: JobAssignee[] = [],
  handovers: JobHandover[] = [],
  partLoans: JobPartLoan[] = []
): JobWithDetails {
  const jobSteps = steps
    .filter((s) => s.job_id === job.id)
    .sort((a, b) => a.order - b.order);
  const jobEvents = events
    .filter((e) => e.job_id === job.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const jobHandovers = handovers
    .filter((h) => h.job_id === job.id)
    .sort((a, b) => a.order - b.order || a.updated_at.localeCompare(b.updated_at));
  const jobPartLoans = partLoans
    .filter((p) => p.job_id === job.id)
    .sort((a, b) => a.order - b.order || a.updated_at.localeCompare(b.updated_at));

  let jobAssigneeRows = assigneesForJob(assignees, job.id);
  if (jobAssigneeRows.length === 0 && job.technician_id) {
    jobAssigneeRows = [
      {
        id: "",
        job_id: job.id,
        technician_id: job.technician_id,
        assigned_at: job.created_at,
        is_lead: "1",
      },
    ];
  }

  const technicians = jobAssigneeRows
    .map((a) => techs.find((t) => t.id === a.technician_id))
    .filter((t): t is Technician => Boolean(t));

  const technician =
    technicians.find((t) => t.id === job.technician_id) || technicians[0] || null;
  const current_steps = jobSteps.filter((s) => s.status === "in_progress");
  const current_step = current_steps[0] || null;
  return {
    ...job,
    technician,
    technicians,
    steps: jobSteps,
    events: jobEvents,
    handovers: jobHandovers,
    part_loans: jobPartLoans,
    elapsed_sec: calcElapsedSec(job),
    progress_pct: calcProgressPct(jobSteps),
    current_step,
    current_steps,
  };
}

export async function getDashboard(): Promise<DashboardData> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const assignees = loadAssignees(wb, jobs);
    const handovers = loadHandovers(wb);
    const partLoans = loadPartLoans(wb);
    const hadUnits = readRows(getSheet(wb, SHEETS.units)).length > 0;
    const units = loadUnits(wb, jobs);
    const usersSeeded = await ensureUsers(wb);
    const techSnMigrated = migrateTechnicianSnColumn(wb);
    const unitSerialMigrated = migrateUnitSerialNumberColumn(wb);
    const stepStdMigrated = migrateJobStepStdMinutes(wb, jobs, steps);
    steps = stepStdMigrated.steps;
    if (
      (!hadUnits && units.length > 0) ||
      usersSeeded ||
      techSnMigrated ||
      unitSerialMigrated ||
      stepStdMigrated.changed
    ) {
      if (!hadUnits && units.length > 0) {
        writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
        writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      }
      await saveWorkbook(wb);
    }

    const techsFresh = techSnMigrated
      ? readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician)
      : techs;

    const detailed = jobs.map((j) =>
      enrichJob(j, techsFresh, steps, events, assignees, handovers, partLoans)
    );
    const completedJobs = await listCompletedJobDetails(techsFresh);
    const cancelledJobs = await listCancelledJobDetails(techsFresh);
    const today = new Date().toISOString().slice(0, 10);
    const doneToday = completedJobs.filter((j) =>
      (j.completed_at || "").startsWith(today)
    );
    const avg =
      doneToday.length === 0
        ? 0
        : Math.round(
            doneToday.reduce((sum, j) => sum + j.elapsed_sec, 0) /
              doneToday.length
          );

    return {
      technicians: techsFresh,
      units,
      jobs: detailed,
      completed_jobs: completedJobs,
      cancelled_jobs: cancelledJobs,
      attendance: readRows(getSheet(wb, SHEETS.attendance))
        .map(mapAttendance)
        .filter((a) => a.id && a.date)
        .sort((a, b) =>
          b.date.localeCompare(a.date) ||
          a.technician_name.localeCompare(b.technician_name)
        ),
      summary: {
        available: techsFresh.filter((t) => t.status === "available").length,
        busy: techsFresh.filter((t) => t.status === "busy").length,
        offline: techsFresh.filter((t) => t.status === "offline").length,
        active_jobs: detailed.filter((j) =>
          ["in_progress", "paused", "assigned"].includes(j.status)
        ).length,
        queued_jobs: detailed.filter((j) => j.status === "queued").length,
        done_today: doneToday.length,
        completed_jobs: completedJobs.length,
        cancelled_jobs: cancelledJobs.length,
        avg_duration_sec: avg,
      },
    };
  });
}

type JobStepCreateInput =
  | string
  | {
      id?: string;
      name: string;
      std_minutes?: number;
    };

function normalizeJobStepInputs(
  raw?: JobStepCreateInput[]
): Array<{ id?: string; name: string; std_minutes: number }> {
  if (!raw?.length) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name, std_minutes: 0 } : null;
      }
      const name = String(item?.name || "").trim();
      if (!name) return null;
      return {
        id: item.id ? String(item.id).trim() : undefined,
        name,
        std_minutes: Number(item.std_minutes || 0) || 0,
      };
    })
    .filter((row): row is { id?: string; name: string; std_minutes: number } =>
      Boolean(row)
    );
}

export async function createJob(input: {
  id?: string;
  title: string;
  unit_id: string;
  description?: string;
  estimated_minutes?: number;
  steps?: JobStepCreateInput[];
  template_id?: string;
  actor?: AuditActor | null;
}): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const audits = loadAuditLog(wb);
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const units = loadUnits(wb, jobs);
    const assignees = loadAssignees(wb, jobs);
    const handovers = loadHandovers(wb);
    const partLoans = loadPartLoans(wb);

    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = jobs.find((j) => j.id === requestedId);
      if (existing) {
        return enrichJob(
          existing,
          techs,
          steps,
          events,
          assignees,
          handovers,
          partLoans
        );
      }
    }

    const unit = units.find((u) => u.id === input.unit_id && u.active === "1");
    if (!unit) throw new Error("Unit tidak ditemukan / nonaktif");

    const templateId = input.template_id ? String(input.template_id).trim() : "";
    const template = templateId ? getJobTemplate(templateId) : null;
    if (templateId && !template) {
      throw new Error("Template job tidak ditemukan");
    }

    const clientSteps = normalizeJobStepInputs(input.steps);
    const fromTemplate = template ? stepsFromTemplate(template) : [];
    const stepDefs =
      clientSteps.length > 0
        ? clientSteps.map((step, i) => ({
            id: step.id,
            name: step.name,
            std_minutes: step.std_minutes || fromTemplate[i]?.std_minutes || 0,
          }))
        : fromTemplate.length > 0
          ? fromTemplate
          : ["Diagnosis", "Perbaikan", "Test & QC"].map((name) => ({
              name,
              std_minutes: 0,
            }));

    const estimated =
      template?.std_minutes ||
      input.estimated_minutes ||
      60;

    const id =
      requestedId ||
      `J${String(jobs.length + 1).padStart(2, "0")}-${uuidv4().slice(0, 4)}`;
    const created_at = nowIso();
    const job: Job = {
      id,
      title: input.title,
      unit: unitLabel(unit),
      unit_id: unit.id,
      description: input.description || "",
      status: "queued",
      technician_id: "",
      template_id: template?.id || "",
      created_at,
      started_at: "",
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: estimated,
    };
    jobs.push(job);

    stepDefs.forEach((def, i) => {
      steps.push({
        id:
          "id" in def && typeof def.id === "string" && def.id
            ? def.id
            : uuidv4(),
        job_id: id,
        name: def.name,
        order: i + 1,
        status: "pending",
        started_at: "",
        completed_at: "",
        duration_sec: 0,
        std_minutes: Number(def.std_minutes || 0),
      });
    });

    const note = template
      ? `Job dibuat dari template ${template.name}`
      : "Job dibuat";
    const who = formatActorLabel(input.actor);
    events.push(
      makeJobEvent(
        id,
        "created",
        who ? `${note} · oleh ${who}` : note,
        input.actor,
        created_at
      )
    );
    audits.push(
      makeAuditEntry({
        action: "create",
        entity: "job",
        entity_id: id,
        detail: `${job.title} · ${job.unit} · ${stepDefs.length} steps`,
        actor: input.actor,
        at: created_at,
      })
    );

    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "create",
      entity: "job",
      entity_id: id,
      job_id: id,
      summary: `Buat job ${job.title} · ${job.unit}`,
      before: null,
      after: buildJobChangeBundle(
        id,
        jobs,
        steps,
        [],
        [],
        [],
        techs
      ),
      actor: input.actor,
      at: created_at,
    });
    await saveWorkbook(wb);
    return enrichJob(job, techs, steps, events, []);
  });
}

export async function updateJob(
  jobId: string,
  input: {
    title: string;
    unit_id: string;
    description?: string;
    estimated_minutes?: number;
    steps?: string[];
    actor?: AuditActor | null;
  }
): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const audits = loadAuditLog(wb);
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const assignees = loadAssignees(wb, jobs);
    const units = loadUnits(wb, jobs);

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    const handoversBefore = loadHandovers(wb);
    const partLoansBefore = loadPartLoans(wb);
    const beforeBundle = buildJobChangeBundle(
      jobId,
      jobs,
      steps,
      assignees,
      handoversBefore,
      partLoansBefore,
      techs
    );

    const title = input.title.trim();
    if (!title || !input.unit_id) throw new Error("title dan unit wajib diisi");

    const unit = units.find((u) => u.id === input.unit_id);
    if (!unit) throw new Error("Unit tidak ditemukan");
    if (unit.active !== "1" && unit.id !== job.unit_id) {
      throw new Error("Unit nonaktif");
    }

    job.title = title;
    job.unit_id = unit.id;
    job.unit = unitLabel(unit);
    job.description = input.description?.trim() || "";
    job.estimated_minutes = input.estimated_minutes || job.estimated_minutes || 60;

    const canRewriteSteps = ["queued", "assigned"].includes(job.status);
    if (canRewriteSteps && input.steps && input.steps.length > 0) {
      const tpl = job.template_id ? getJobTemplate(job.template_id) : null;
      const tplSteps = tpl ? stepsFromTemplate(tpl) : [];
      steps = steps.filter((s) => s.job_id !== jobId);
      input.steps.forEach((name, i) => {
        const fromTpl = tplSteps.find((t) => t.name === name) || tplSteps[i];
        steps.push({
          id: uuidv4(),
          job_id: jobId,
          name,
          order: i + 1,
          status: "pending",
          started_at: "",
          completed_at: "",
          duration_sec: 0,
          std_minutes: Number(fromTpl?.std_minutes || 0),
        });
      });
    }

    const at = nowIso();
    const who = formatActorLabel(input.actor);
    events.push(
      makeJobEvent(
        jobId,
        "updated",
        who ? `Job diubah · oleh ${who}` : "Job diubah",
        input.actor,
        at
      )
    );
    audits.push(
      makeAuditEntry({
        action: "update",
        entity: "job",
        entity_id: jobId,
        detail: `${job.title} · ${job.unit}`,
        actor: input.actor,
        at,
      })
    );

    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "update",
      entity: "job",
      entity_id: jobId,
      job_id: jobId,
      summary: `Update job ${job.title} · ${job.unit}`,
      before: beforeBundle,
      after: buildJobChangeBundle(
        jobId,
        jobs,
        steps,
        assignees,
        handoversBefore,
        partLoansBefore,
        techs
      ),
      actor: input.actor,
      at,
    });
    await saveWorkbook(wb);
    return enrichJob(job, techs, steps, events, assignees);
  });
}

export async function deleteJob(
  jobId: string,
  actor?: AuditActor | null
): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    let jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    let events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const audits = loadAuditLog(wb);
    let assignees = loadAssignees(wb, jobs);

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    const at = nowIso();
    const jobSteps = steps.filter((s) => s.job_id === jobId);
    const jobEvents = events.filter((e) => e.job_id === jobId);
    const jobAssignees = assignees.filter((a) => a.job_id === jobId);
    let handovers = loadHandovers(wb);
    const jobHandovers = handovers.filter((h) => h.job_id === jobId);
    let partLoans = loadPartLoans(wb);
    const jobPartLoans = partLoans.filter((p) => p.job_id === jobId);

    await archiveDeletedJob({
      job,
      steps: jobSteps,
      events: jobEvents,
      assignees: jobAssignees,
      handovers: jobHandovers,
      part_loans: jobPartLoans,
      technicians: techs,
      actor,
      deleted_at: at,
    });

    const beforeBundle: JobChangeBundle = {
      job: { ...job },
      steps: jobSteps.map((s) => ({ ...s })),
      assignees: jobAssignees.map((a) => ({ ...a })),
      handovers: jobHandovers.map((h) => ({ ...h })),
      part_loans: jobPartLoans.map((p) => ({ ...p })),
      technicians: techSnap(
        techs,
        jobAssignees.map((a) => a.technician_id).concat(job.technician_id || "")
      ),
      meta: { archived_to: "deleted-jobs.xlsx" },
    };

    audits.push(
      makeAuditEntry({
        action: "delete",
        entity: "job",
        entity_id: jobId,
        detail: `${job.title} · ${job.unit} · status ${job.status} · archived to deleted-jobs.xlsx`,
        actor,
        at,
      })
    );

    releaseTechsFromJob(techs, jobId);
    jobs = jobs.filter((j) => j.id !== jobId);
    steps = steps.filter((s) => s.job_id !== jobId);
    events = events.filter((e) => e.job_id !== jobId);
    assignees = assignees.filter((a) => a.job_id !== jobId);
    handovers = handovers.filter((h) => h.job_id !== jobId);
    partLoans = partLoans.filter((p) => p.job_id !== jobId);

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
    writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "delete",
      entity: "job",
      entity_id: jobId,
      job_id: jobId,
      summary: `Hapus job ${job.title} · ${job.unit}`,
      before: beforeBundle,
      after: null,
      actor,
      at,
    });
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function createJobHandover(input: {
  id?: string;
  job_id: string;
  title: string;
  note?: string;
  done?: boolean;
  actor?: AuditActor | null;
}): Promise<JobHandover> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const job = jobs.find((j) => j.id === input.job_id);
    if (!job) throw new Error("Job not found");
    if (!["in_progress", "paused", "done"].includes(job.status)) {
      throw new Error(
        "Handover hanya untuk job in_progress / paused / done"
      );
    }
    const title = input.title.trim();
    if (!title) throw new Error("Judul handover wajib diisi");

    const handovers = loadHandovers(wb);
    const audits = loadAuditLog(wb);
    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = handovers.find((h) => h.id === requestedId);
      if (existing) return existing;
    }
    const forJob = handovers.filter((h) => h.job_id === input.job_id);
    const order =
      forJob.reduce((max, h) => Math.max(max, h.order), 0) + 1;
    const at = nowIso();
    const row: JobHandover = {
      id: requestedId || uuidv4(),
      job_id: input.job_id,
      order,
      title,
      done: input.done ? "1" : "0",
      note: (input.note || "").trim(),
      user_id: input.actor?.user_id || "",
      user_name: input.actor?.user_name || "",
      updated_at: at,
    };
    handovers.push(row);
    audits.push(
      makeAuditEntry({
        action: "handover_create",
        entity: "job_handover",
        entity_id: row.id,
        detail: `${job.title} · #${order} ${title}`,
        actor: input.actor,
        at,
      })
    );
    writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "create",
      entity: "job_handover",
      entity_id: row.id,
      job_id: input.job_id,
      summary: `Tambah handover #${order} ${title}`,
      before: null,
      after: { handover: { ...row }, job: { ...job } },
      actor: input.actor,
      at,
    });
    await saveWorkbook(wb);
    return row;
  });
}

export async function updateJobHandover(
  handoverId: string,
  input: {
    title?: string;
    note?: string;
    done?: boolean;
    actor?: AuditActor | null;
  }
): Promise<JobHandover> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const handovers = loadHandovers(wb);
    const audits = loadAuditLog(wb);
    const row = handovers.find((h) => h.id === handoverId);
    if (!row) throw new Error("Handover tidak ditemukan");
    const job = jobs.find((j) => j.id === row.job_id);
    if (!job) throw new Error("Job not found");
    if (!["in_progress", "paused", "done"].includes(job.status)) {
      throw new Error(
        "Handover hanya bisa diubah pada job in_progress / paused / done"
      );
    }

    const beforeRow = { ...row };

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new Error("Judul handover wajib diisi");
      row.title = title;
    }
    if (input.note !== undefined) row.note = input.note.trim();
    if (input.done !== undefined) row.done = input.done ? "1" : "0";
    row.user_id = input.actor?.user_id || row.user_id;
    row.user_name = input.actor?.user_name || row.user_name;
    row.updated_at = nowIso();

    audits.push(
      makeAuditEntry({
        action: "handover_update",
        entity: "job_handover",
        entity_id: row.id,
        detail: `${job.title} · #${row.order} ${row.title} · done=${row.done === "1" ? "Yes" : "No"}`,
        actor: input.actor,
      })
    );
    writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "update",
      entity: "job_handover",
      entity_id: row.id,
      job_id: row.job_id,
      summary: `Update handover #${row.order} ${row.title}`,
      before: { handover: beforeRow, job: { ...job } },
      after: { handover: { ...row }, job: { ...job } },
      actor: input.actor,
    });
    await saveWorkbook(wb);
    return row;
  });
}

export async function deleteJobHandover(
  handoverId: string,
  actor?: AuditActor | null
): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let handovers = loadHandovers(wb);
    const audits = loadAuditLog(wb);
    const row = handovers.find((h) => h.id === handoverId);
    if (!row) throw new Error("Handover tidak ditemukan");
    const job = jobs.find((j) => j.id === row.job_id);
    if (
      job &&
      !["in_progress", "paused", "done"].includes(job.status)
    ) {
      throw new Error(
        "Handover hanya bisa dihapus pada job in_progress / paused / done"
      );
    }

    handovers = handovers.filter((h) => h.id !== handoverId);
    audits.push(
      makeAuditEntry({
        action: "handover_delete",
        entity: "job_handover",
        entity_id: handoverId,
        detail: `${job?.title || row.job_id} · #${row.order} ${row.title}`,
        actor,
      })
    );
    writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "delete",
      entity: "job_handover",
      entity_id: handoverId,
      job_id: row.job_id,
      summary: `Hapus handover #${row.order} ${row.title}`,
      before: { handover: { ...row }, job: job ? { ...job } : null },
      after: null,
      actor,
    });
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function createJobPartLoan(input: {
  id?: string;
  job_id: string;
  part_name: string;
  note?: string;
  status?: PartLoanStatus;
  actor?: AuditActor | null;
}): Promise<JobPartLoan> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const job = jobs.find((j) => j.id === input.job_id);
    if (!job) throw new Error("Job not found");
    if (!["in_progress", "paused", "done"].includes(job.status)) {
      throw new Error(
        "Peminjaman part hanya untuk job in_progress / paused / done"
      );
    }
    const part_name = input.part_name.trim();
    if (!part_name) throw new Error("Nama part wajib diisi");

    const partLoans = loadPartLoans(wb);
    const audits = loadAuditLog(wb);
    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = partLoans.find((p) => p.id === requestedId);
      if (existing) return existing;
    }
    const forJob = partLoans.filter((p) => p.job_id === input.job_id);
    const order =
      forJob.reduce((max, p) => Math.max(max, p.order), 0) + 1;
    const at = nowIso();
    const status: PartLoanStatus =
      input.status === "closed" ? "closed" : "open";
    const row: JobPartLoan = {
      id: requestedId || uuidv4(),
      job_id: input.job_id,
      order,
      part_name,
      status,
      note: (input.note || "").trim(),
      user_id: input.actor?.user_id || "",
      user_name: input.actor?.user_name || "",
      updated_at: at,
    };
    partLoans.push(row);
    audits.push(
      makeAuditEntry({
        action: "part_loan_create",
        entity: "job_part_loan",
        entity_id: row.id,
        detail: `${job.title} · #${order} ${part_name} · ${status}`,
        actor: input.actor,
        at,
      })
    );
    writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "create",
      entity: "job_part_loan",
      entity_id: row.id,
      job_id: input.job_id,
      summary: `Tambah part loan #${order} ${part_name}`,
      before: null,
      after: { part_loan: { ...row }, job: { ...job } },
      actor: input.actor,
      at,
    });
    await saveWorkbook(wb);
    return row;
  });
}

export async function updateJobPartLoan(
  loanId: string,
  input: {
    part_name?: string;
    note?: string;
    status?: PartLoanStatus;
    actor?: AuditActor | null;
  }
): Promise<JobPartLoan> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const partLoans = loadPartLoans(wb);
    const audits = loadAuditLog(wb);
    const row = partLoans.find((p) => p.id === loanId);
    if (!row) throw new Error("Peminjaman part tidak ditemukan");
    const job = jobs.find((j) => j.id === row.job_id);
    if (!job) throw new Error("Job not found");
    if (!["in_progress", "paused", "done"].includes(job.status)) {
      throw new Error(
        "Peminjaman part hanya bisa diubah pada job in_progress / paused / done"
      );
    }

    const beforeRow = { ...row };

    if (input.part_name !== undefined) {
      const part_name = input.part_name.trim();
      if (!part_name) throw new Error("Nama part wajib diisi");
      row.part_name = part_name;
    }
    if (input.note !== undefined) row.note = input.note.trim();
    if (input.status !== undefined) {
      row.status = input.status === "closed" ? "closed" : "open";
    }
    row.user_id = input.actor?.user_id || row.user_id;
    row.user_name = input.actor?.user_name || row.user_name;
    row.updated_at = nowIso();

    audits.push(
      makeAuditEntry({
        action: "part_loan_update",
        entity: "job_part_loan",
        entity_id: row.id,
        detail: `${job.title} · #${row.order} ${row.part_name} · ${row.status}`,
        actor: input.actor,
      })
    );
    writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "update",
      entity: "job_part_loan",
      entity_id: row.id,
      job_id: row.job_id,
      summary: `Update part loan #${row.order} ${row.part_name}`,
      before: { part_loan: beforeRow, job: { ...job } },
      after: { part_loan: { ...row }, job: { ...job } },
      actor: input.actor,
    });
    await saveWorkbook(wb);
    return row;
  });
}

export async function deleteJobPartLoan(
  loanId: string,
  actor?: AuditActor | null
): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let partLoans = loadPartLoans(wb);
    const audits = loadAuditLog(wb);
    const row = partLoans.find((p) => p.id === loanId);
    if (!row) throw new Error("Peminjaman part tidak ditemukan");
    const job = jobs.find((j) => j.id === row.job_id);
    if (
      job &&
      !["in_progress", "paused", "done"].includes(job.status)
    ) {
      throw new Error(
        "Peminjaman part hanya bisa dihapus pada job in_progress / paused / done"
      );
    }

    partLoans = partLoans.filter((p) => p.id !== loanId);
    audits.push(
      makeAuditEntry({
        action: "part_loan_delete",
        entity: "job_part_loan",
        entity_id: loanId,
        detail: `${job?.title || row.job_id} · #${row.order} ${row.part_name}`,
        actor,
      })
    );
    writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action: "delete",
      entity: "job_part_loan",
      entity_id: loanId,
      job_id: row.job_id,
      summary: `Hapus part loan #${row.order} ${row.part_name}`,
      before: { part_loan: { ...row }, job: job ? { ...job } : null },
      after: null,
      actor,
    });
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function createUnit(input: {
  id?: string;
  code: string;
  name: string;
  serial_number: string;
}): Promise<Unit> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const units = loadUnits(wb, jobs);
    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = units.find((u) => u.id === requestedId);
      if (existing) return existing;
    }
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const serial_number = input.serial_number.trim();
    if (!code || !name || !serial_number) {
      throw new Error("code, name, dan serial_number wajib diisi");
    }
    if (units.some((u) => u.code.toUpperCase() === code)) {
      throw new Error("Nomor unit sudah dipakai");
    }
    const unit: Unit = {
      id: requestedId || `U-${uuidv4().slice(0, 8)}`,
      code,
      name,
      serial_number,
      active: "1",
    };
    units.push(unit);
    writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
    await saveWorkbook(wb);
    return unit;
  });
}

export async function updateUnit(
  unitId: string,
  input: { code: string; name: string; serial_number: string; active?: string }
): Promise<Unit> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const units = loadUnits(wb, jobs);
    const unit = units.find((u) => u.id === unitId);
    if (!unit) throw new Error("Unit not found");
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const serial_number = input.serial_number.trim();
    if (!code || !name || !serial_number) {
      throw new Error("code, name, dan serial_number wajib diisi");
    }
    if (units.some((u) => u.id !== unitId && u.code.toUpperCase() === code)) {
      throw new Error("Nomor unit sudah dipakai");
    }
    unit.code = code;
    unit.name = name;
    unit.serial_number = serial_number;
    if (input.active === "0" || input.active === "1") unit.active = input.active;

    // Refresh denormalized label on jobs that use this unit
    const label = unitLabel(unit);
    jobs.forEach((j) => {
      if (j.unit_id === unitId) j.unit = label;
    });

    writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    await saveWorkbook(wb);
    return unit;
  });
}

export async function deleteUnit(unitId: string): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let units = loadUnits(wb, jobs);
    const unit = units.find((u) => u.id === unitId);
    if (!unit) throw new Error("Unit not found");
    const usedBy = jobs.filter((j) => j.unit_id === unitId);
    if (usedBy.length > 0) {
      throw new Error(
        `Unit masih dipakai ${usedBy.length} job. Hapus/ubah job terkait dulu, atau nonaktifkan lewat Edit.`
      );
    }
    units = units.filter((u) => u.id !== unitId);
    writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}

function normalizeUnitStatus(raw: string): "1" | "0" | null {
  const status = raw.trim().toLowerCase();
  if (!status) return null;
  if (["1", "aktif", "active", "ya", "yes"].includes(status)) return "1";
  if (["0", "nonaktif", "non-aktif", "inactive", "tidak", "no"].includes(status)) {
    return "0";
  }
  return null;
}

export async function importUnitsFromBuffer(
  buffer: ArrayBuffer | Buffer
): Promise<{
  imported: number;
  updated: number;
  skipped: string[];
}> {
  return withDbLock(async () => {
    const src = new ExcelJS.Workbook();
    const bytes =
      buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.from(buffer);
    await src.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = src.worksheets[0];
    if (!ws) throw new Error("File Excel kosong / tidak ada sheet");

    const headerMap: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, column) => {
      const key = cellStr(cell.value).trim().toLowerCase();
      if (key) headerMap[key] = column;
    });
    const col = (...names: string[]) => {
      for (const name of names) {
        const column = headerMap[name.toLowerCase()];
        if (column) return column;
      }
      return 0;
    };

    const cCode = col("nomor unit", "no unit", "no. unit", "code", "kode", "unit");
    const cName = col("model", "name", "nama", "nama unit");
    const cSerial = col(
      "serial number",
      "serial_number",
      "serialnumber",
      "nomor seri",
      "no seri",
      "no. seri",
      "sn"
    );
    const cStatus = col("status", "active", "aktif");
    if (!cCode || !cName || !cSerial) {
      throw new Error(
        'Kolom wajib tidak ditemukan. Butuh header "Nomor unit", "Model", dan "Serial number".'
      );
    }

    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const units = loadUnits(wb, jobs);
    const skipped: string[] = [];
    let imported = 0;
    let updated = 0;
    let changed = false;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const code = cellStr(row.getCell(cCode).value).trim().toUpperCase();
      const name = cellStr(row.getCell(cName).value).trim();
      const serial_number = cellStr(row.getCell(cSerial).value).trim();
      const statusRaw = cStatus
        ? cellStr(row.getCell(cStatus).value).trim()
        : "";
      if (!code && !name && !serial_number && !statusRaw) return;
      if (!code || !name || !serial_number) {
        skipped.push(
          `Baris ${rowNumber}: nomor unit, model, dan serial number wajib (${code || "?"} / ${name || "?"} / ${serial_number || "?"})`
        );
        return;
      }

      const active = normalizeUnitStatus(statusRaw);
      if (statusRaw && !active) {
        skipped.push(
          `Baris ${rowNumber}: status "${statusRaw}" tidak valid (gunakan aktif/nonaktif)`
        );
        return;
      }

      const existing = units.find((unit) => unit.code.toUpperCase() === code);
      if (existing) {
        existing.name = name;
        existing.serial_number = serial_number;
        if (active) existing.active = active;
        const label = unitLabel(existing);
        jobs.forEach((job) => {
          if (job.unit_id === existing.id) job.unit = label;
        });
        updated += 1;
        changed = true;
        return;
      }

      units.push({
        id: `U-${uuidv4().slice(0, 8)}`,
        code,
        name,
        serial_number,
        active: active || "1",
      });
      imported += 1;
      changed = true;
    });

    if (!changed && skipped.length === 0) {
      throw new Error("Tidak ada baris data unit yang bisa diimpor");
    }
    if (changed) {
      writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
      writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      await saveWorkbook(wb);
    }
    return {
      imported,
      updated,
      skipped: skipped.slice(0, 50),
    };
  });
}

export async function setTechnicianStatus(
  techId: string,
  status: TechnicianStatus
): Promise<Technician> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const tech = techs.find((t) => t.id === techId);
    if (!tech) throw new Error("Technician not found");
    if (tech.status === "busy" && status !== "busy") {
      throw new Error("Teknisi sedang mengerjakan job. Selesaikan job dulu.");
    }
    tech.status = status;
    if (status !== "busy") tech.current_job_id = "";
    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    await saveWorkbook(wb);
    return tech;
  });
}

export async function createTechnician(input: {
  id?: string;
  name: string;
  sn: string;
  phone?: string;
  status?: Exclude<TechnicianStatus, "busy">;
}): Promise<Technician> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = techs.find((t) => t.id === requestedId);
      if (existing) return existing;
    }
    const name = input.name.trim();
    const sn = input.sn.trim();
    const phone = (input.phone || "").trim();
    if (!name || !sn || !phone) {
      throw new Error("nama, SN, dan telepon wajib diisi");
    }
    const status: TechnicianStatus =
      input.status === "offline" ? "offline" : "available";
    const tech: Technician = {
      id: requestedId || `T-${uuidv4().slice(0, 8)}`,
      name,
      sn,
      status,
      current_job_id: "",
      phone,
    };
    techs.push(tech);
    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    await saveWorkbook(wb);
    return tech;
  });
}

function normalizeTechStatus(
  raw: string
): Exclude<TechnicianStatus, "busy"> | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["offline", "off", "tidak hadir"].includes(s)) return "offline";
  if (["available", "avail", "hadir", "aktif", "active"].includes(s)) {
    return "available";
  }
  return null;
}

export async function importTechniciansFromBuffer(
  buffer: ArrayBuffer | Buffer,
  opts?: {
    /** Create missing technicians when phone column absent (uses placeholder). */
    createMissingWithoutPhone?: boolean;
    /** If false, only update existing SN matches (default true for file upload). */
    createMissing?: boolean;
  }
): Promise<{
  imported: number;
  updated: number;
  skipped: string[];
  unmatched: string[];
}> {
  const createMissing = opts?.createMissing !== false;
  const createMissingWithoutPhone = opts?.createMissingWithoutPhone === true;

  return withDbLock(async () => {
    const src = new ExcelJS.Workbook();
    const bytes =
      buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.from(buffer);
    await src.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = src.worksheets[0];
    if (!ws) throw new Error("File Excel kosong / tidak ada sheet");

    const found = findSheetHeader(ws, TECH_SN_HEADERS, TECH_NAME_HEADERS);
    if (!found) {
      throw new Error(
        'Kolom wajib tidak ditemukan. Butuh "Nama Karyawan" / "Nama" dan "No. ID Badge" / "SN" / "Pernr".'
      );
    }
    const { headerRow, headerMap } = found;

    const col = (...names: string[]) => {
      for (const n of names) {
        const c = headerMap[n.toLowerCase()];
        if (c) return c;
      }
      return 0;
    };

    const cName = col(...TECH_NAME_HEADERS);
    const cSn = col(...TECH_SN_HEADERS);
    const cPhone = col("phone", "telepon", "telp", "hp", "no hp", "no. hp");
    const cStatus = col("status");

    if (!cName || !cSn) {
      throw new Error(
        'Kolom wajib tidak ditemukan. Butuh "Nama Karyawan" / "Nama" dan "No. ID Badge" / "SN" / "Pernr".'
      );
    }

    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const skipped: string[] = [];
    const unmatched: string[] = [];
    let imported = 0;
    let updated = 0;
    let changed = false;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const name = cellStr(row.getCell(cName).value).trim();
      const sn = cellStr(row.getCell(cSn).value).trim();
      const phone = cPhone ? cellStr(row.getCell(cPhone).value).trim() : "";
      const statusRaw = cStatus
        ? cellStr(row.getCell(cStatus).value).trim()
        : "";
      if (!name && !sn) return;
      if (!name || !sn) {
        skipped.push(
          `Baris ${rowNumber}: nama dan No. ID Badge/SN wajib (${name || "?"} / ${sn || "?"})`
        );
        return;
      }

      const status = normalizeTechStatus(statusRaw);
      const existing = techs.find(
        (t) => t.sn.trim().toLowerCase() === sn.toLowerCase()
      );

      if (existing) {
        existing.name = name;
        existing.sn = sn;
        if (phone) existing.phone = phone;
        if (status && existing.status !== "busy") {
          existing.status = status;
          existing.current_job_id = "";
        }
        updated += 1;
        changed = true;
        return;
      }

      if (!createMissing) {
        unmatched.push(`${sn} — ${name}`);
        return;
      }

      if (!phone && !createMissingWithoutPhone) {
        skipped.push(`Baris ${rowNumber}: ${name} — telepon wajib untuk data baru`);
        return;
      }

      techs.push({
        id: `T-${uuidv4().slice(0, 8)}`,
        name,
        sn,
        phone: phone || "-",
        status: status || "available",
        current_job_id: "",
      });
      imported += 1;
      changed = true;
    });

    if (!changed && skipped.length === 0 && unmatched.length === 0) {
      throw new Error("Tidak ada baris data teknisi yang bisa diimpor");
    }
    if (changed) {
      writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
      await saveWorkbook(wb);
    }
    return {
      imported,
      updated,
      skipped: skipped.slice(0, 50),
      unmatched: [...new Set(unmatched)].slice(0, 50),
    };
  });
}

export async function updateTechnician(
  techId: string,
  input: {
    name: string;
    sn: string;
    phone?: string;
    status?: Exclude<TechnicianStatus, "busy">;
  }
): Promise<Technician> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const tech = techs.find((t) => t.id === techId);
    if (!tech) throw new Error("Technician not found");
    const name = input.name.trim();
    const sn = input.sn.trim();
    const phone = (input.phone ?? tech.phone).trim();
    if (!name || !sn || !phone) {
      throw new Error("nama, SN, dan telepon wajib diisi");
    }
    tech.name = name;
    tech.sn = sn;
    tech.phone = phone;
    if (input.status === "available" || input.status === "offline") {
      if (tech.status === "busy") {
        throw new Error("Teknisi sedang mengerjakan job. Selesaikan job dulu.");
      }
      tech.status = input.status;
      tech.current_job_id = "";
    }
    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    await saveWorkbook(wb);
    return tech;
  });
}

export async function deleteTechnician(techId: string): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    let techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let assignees = loadAssignees(wb, jobs);
    const tech = techs.find((t) => t.id === techId);
    if (!tech) throw new Error("Technician not found");
    if (tech.status === "busy" || tech.current_job_id) {
      throw new Error(
        "Teknisi sedang mengerjakan job. Selesaikan/lepas job dulu sebelum hapus."
      );
    }
    const activeJobIds = new Set(
      jobs
        .filter((j) => !["done", "cancelled"].includes(j.status))
        .map((j) => j.id)
    );
    const activeLinks = assignees.filter(
      (a) => a.technician_id === techId && activeJobIds.has(a.job_id)
    );
    if (activeLinks.length > 0) {
      throw new Error(
        `Teknisi masih terpasang di ${activeLinks.length} job aktif. Lepas assign dulu.`
      );
    }
    techs = techs.filter((t) => t.id !== techId);
    assignees = assignees.filter((a) => a.technician_id !== techId);
    jobs.forEach((j) => {
      if (j.technician_id === techId) j.technician_id = "";
    });
    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}

type JobAction =
  | "assign"
  | "start"
  | "pause"
  | "resume"
  | "start_step"
  | "start_steps"
  | "complete_step"
  | "complete"
  | "cancel"
  | "reopen";

export async function jobAction(
  jobId: string,
  action: JobAction,
  payload?: {
    technician_id?: string;
    technician_ids?: string[];
    step_id?: string;
    step_ids?: string[];
    /** sequential: auto-start first / next step. parallel: manual checkbox batch. */
    step_mode?: "sequential" | "parallel";
    auto_start_first?: boolean;
    auto_next?: boolean;
    note?: string;
    actor?: AuditActor | null;
    /** Frozen client clock (offline complete/pause) so sync does not recount from Date.now(). */
    duration_sec?: number;
    completed_at?: string;
    started_at?: string;
    /** When sequential auto-next starts the following step (client clock). */
    next_started_at?: string;
    paused_at?: string;
    total_paused_sec?: number;
    resumed_at?: string;
    step_snapshots?: Array<{
      id: string;
      duration_sec: number;
      started_at?: string;
    }>;
  }
): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    let jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    let events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const audits = loadAuditLog(wb);
    let handovers = loadHandovers(wb);
    let partLoans = loadPartLoans(wb);
    let assignees = loadAssignees(wb, jobs);
    const actor = payload?.actor || null;

    const pushAudit = (auditAction: string, detail: string, entityId = jobId) => {
      audits.push(
        makeAuditEntry({
          action: auditAction,
          entity: "job",
          entity_id: entityId,
          detail,
          actor,
        })
      );
    };

    /** Restore completed/cancelled job from archive (or legacy live done/cancelled). */
    if (action === "reopen") {
      const live = jobs.find((j) => j.id === jobId);

      const activateLastStep = (jobStepsList: typeof steps) => {
        const ordered = jobStepsList
          .filter((s) => s.job_id === jobId)
          .sort((a, b) => a.order - b.order);
        const hasActive = ordered.some((s) => s.status === "in_progress");
        if (!hasActive && ordered.length > 0) {
          const last = ordered[ordered.length - 1];
          if (last.status === "done") {
            last.status = "in_progress";
            last.started_at = "";
            last.completed_at = "";
          }
        }
      };

      const rebindTechs = (rows: typeof assignees) => {
        for (const a of rows.filter((x) => x.job_id === jobId)) {
          const tech = techs.find((t) => t.id === a.technician_id);
          if (!tech) continue;
          if (tech.status === "available" || !tech.current_job_id) {
            tech.status = "busy";
            tech.current_job_id = jobId;
          }
        }
      };

      if (live && (live.status === "done" || live.status === "cancelled")) {
        if (live.started_at || live.status === "done") {
          live.status = "paused";
          live.completed_at = "";
          live.paused_at = nowIso();
          activateLastStep(steps);
          rebindTechs(assignees);
        } else if (assigneesForJob(assignees, jobId).length > 0) {
          live.status = "assigned";
          live.completed_at = "";
          live.paused_at = "";
          rebindTechs(assignees);
        } else {
          live.status = "queued";
          live.completed_at = "";
          live.paused_at = "";
        }
        const who = formatActorLabel(actor);
        const note =
          payload?.note || `Job dibuka kembali (status ${live.status})`;
        events.push(
          makeJobEvent(
            jobId,
            "reopened",
            who ? `${note} · oleh ${who}` : note,
            actor
          )
        );
        pushAudit(
          "reopen",
          `${live.title} · ${live.unit} · status ${live.status}`
        );
        writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
        writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
        writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
        writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
        writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
        writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
        await saveWorkbook(wb);
        return enrichJob(live, techs, steps, events, assignees, handovers, partLoans);
      }

      if (live) {
        throw new Error(
          "Hanya job completed/cancelled yang bisa dibuka kembali"
        );
      }

      let source = "completed-jobs.xlsx";
      let snap = await takeCompletedJobFromArchive(jobId);
      if (!snap) {
        snap = await takeCancelledJobFromArchive(jobId);
        source = "cancelled-jobs.xlsx";
      }
      if (!snap) {
        throw new Error(
          "Job tidak ditemukan di archive completed-jobs / cancelled-jobs"
        );
      }

      const restored: Job = { ...snap.job };
      const restoredSteps = snap.steps.map((s) => ({ ...s }));
      const usePaused =
        source === "completed-jobs.xlsx" || Boolean(restored.started_at);

      if (usePaused) {
        restored.status = "paused";
        restored.completed_at = "";
        restored.paused_at = nowIso();
        const ordered = restoredSteps.sort((a, b) => a.order - b.order);
        const hasActive = ordered.some((s) => s.status === "in_progress");
        if (!hasActive && ordered.length > 0) {
          const last = ordered[ordered.length - 1];
          if (last.status === "done") {
            last.status = "in_progress";
            last.started_at = "";
            last.completed_at = "";
          }
        }
      } else if (snap.assignees.length > 0) {
        restored.status = "assigned";
        restored.completed_at = "";
        restored.paused_at = "";
      } else {
        restored.status = "queued";
        restored.completed_at = "";
        restored.paused_at = "";
      }

      jobs.push(restored);
      steps.push(...restoredSteps);
      events.push(...snap.events);
      assignees.push(...snap.assignees);
      handovers.push(...snap.handovers);
      partLoans.push(...snap.part_loans);

      if (restored.status === "paused" || restored.status === "assigned") {
        for (const a of snap.assignees) {
          const tech = techs.find((t) => t.id === a.technician_id);
          if (!tech) continue;
          if (tech.status === "available" || !tech.current_job_id) {
            tech.status = "busy";
            tech.current_job_id = jobId;
          }
        }
      }

      const who = formatActorLabel(actor);
      const note =
        payload?.note ||
        `Job dibuka kembali dari ${source} (status ${restored.status})`;
      events.push(
        makeJobEvent(
          jobId,
          "reopened",
          who ? `${note} · oleh ${who}` : note,
          actor
        )
      );
      pushAudit(
        "reopen",
        `${restored.title} · ${restored.unit} · restored from ${source}`
      );

      writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
      writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
      writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
      writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
      writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
      writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
      writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
      await saveWorkbook(wb);
      return enrichJob(
        restored,
        techs,
        steps,
        events,
        assignees,
        handovers,
        partLoans
      );
    }

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    const beforeBundle = buildJobChangeBundle(
      jobId,
      jobs,
      steps,
      assignees,
      handovers,
      partLoans,
      techs
    );

    const pushEvent = (type: JobEventType, note: string) => {
      const who = formatActorLabel(actor);
      const stamped = who ? `${note} · oleh ${who}` : note;
      events.push(makeJobEvent(jobId, type, stamped, actor));
    };

    const jobSteps = () =>
      steps.filter((s) => s.job_id === jobId).sort((a, b) => a.order - b.order);

    if (action === "assign") {
      const ids = Array.from(
        new Set(
          (payload?.technician_ids?.length
            ? payload.technician_ids
            : payload?.technician_id
              ? [payload.technician_id]
              : []
          ).map(String).filter(Boolean)
        )
      );
      if (ids.length === 0) throw new Error("Pilih minimal 1 teknisi");
      const assignable = ["queued", "assigned", "in_progress", "paused"];
      if (!assignable.includes(job.status)) {
        throw new Error("Job tidak bisa di-assign pada status ini");
      }

      const selected = ids.map((id) => {
        const tech = techs.find((t) => t.id === id);
        if (!tech) throw new Error(`Technician ${id} not found`);
        return tech;
      });

      for (const tech of selected) {
        const onThisJob = tech.current_job_id === job.id;
        if (!onThisJob && tech.status !== "available") {
          throw new Error(`${tech.name} tidak available`);
        }
      }

      const prevStatus = job.status;
      // Release previous assignees on this job
      releaseTechsFromJob(techs, job.id);
      assignees = assignees.filter((a) => a.job_id !== job.id);

      const now = nowIso();
      selected.forEach((tech, index) => {
        tech.status = "busy";
        tech.current_job_id = job.id;
        assignees.push({
          id: uuidv4(),
          job_id: job.id,
          technician_id: tech.id,
          assigned_at: now,
          is_lead: index === 0 ? "1" : "0",
        });
      });

      job.technician_id = selected[0].id;
      // Keep progress status; only promote queued → assigned
      if (prevStatus === "queued") {
        job.status = "assigned";
      }
      const names = selected.map((t) => t.name).join(", ");
      pushEvent(
        "assigned",
        ["in_progress", "paused"].includes(prevStatus)
          ? `Teknisi diubah: ${names}`
          : `Diassign ke ${names}`
      );
    }

    if (action === "start") {
      const jobAssignees = assigneesForJob(assignees, job.id);
      const assigneeIds =
        jobAssignees.length > 0
          ? jobAssignees.map((a) => a.technician_id)
          : job.technician_id
            ? [job.technician_id]
            : [];
      if (assigneeIds.length === 0) throw new Error("Assign teknisi dulu");
      if (!["assigned", "queued"].includes(job.status)) {
        throw new Error("Job tidak bisa di-start");
      }
      assigneeIds.forEach((id) => {
        const tech = techs.find((t) => t.id === id);
        if (!tech) throw new Error("Technician not found");
        if (job.status === "queued" && tech.status !== "available") {
          throw new Error(`${tech.name} tidak available`);
        }
        tech.status = "busy";
        tech.current_job_id = job.id;
      });
      if (!job.technician_id) job.technician_id = assigneeIds[0];
      job.status = "in_progress";
      const startedAt = clientTimeIso(payload?.started_at);
      job.started_at = startedAt;
      job.paused_at = "";
      const autoFirst =
        payload?.auto_start_first === true ||
        (payload?.step_mode === "sequential" &&
          payload?.auto_start_first !== false);
      if (autoFirst) {
        const first = jobSteps().find((s) => s.status === "pending");
        if (first) {
          first.status = "in_progress";
          first.started_at = startedAt;
          pushEvent("step_started", first.name);
        }
      }
      pushEvent(
        "started",
        payload?.note ||
          (autoFirst
            ? "Pekerjaan dimulai (mode berurutan)"
            : "Pekerjaan dimulai (mode parallel)")
      );
    }

    if (action === "pause") {
      if (job.status !== "in_progress") throw new Error("Hanya job in_progress yang bisa di-pause");
      const snapshots = payload?.step_snapshots || [];
      const byId = new Map(snapshots.map((s) => [s.id, s]));
      const pauseNow = Date.now();
      jobSteps().forEach((s) => {
        if (s.status !== "in_progress") return;
        const snap = byId.get(s.id);
        if (snap && Number.isFinite(snap.duration_sec)) {
          s.duration_sec = Math.max(0, Math.floor(snap.duration_sec));
          s.started_at = snap.started_at != null ? String(snap.started_at) : "";
          return;
        }
        if (s.started_at) {
          const started = new Date(s.started_at).getTime();
          s.duration_sec =
            Math.max(0, s.duration_sec || 0) +
            Math.max(0, Math.floor((pauseNow - started) / 1000));
          s.started_at = "";
        }
      });
      job.status = "paused";
      job.paused_at = payload?.paused_at || nowIso();
      pushEvent("paused", payload?.note || "Job dipause");
    }

    if (action === "resume") {
      if (job.status !== "paused") throw new Error("Hanya job paused yang bisa di-resume");
      if (
        typeof payload?.total_paused_sec === "number" &&
        Number.isFinite(payload.total_paused_sec)
      ) {
        job.total_paused_sec = Math.max(0, Math.floor(payload.total_paused_sec));
      } else {
        const pausedAt = job.paused_at ? new Date(job.paused_at).getTime() : Date.now();
        const extra = Math.max(0, Math.floor((Date.now() - pausedAt) / 1000));
        job.total_paused_sec = (job.total_paused_sec || 0) + extra;
      }
      job.paused_at = "";
      job.status = "in_progress";
      const resumeAt = payload?.resumed_at || nowIso();
      jobSteps().forEach((s) => {
        if (s.status === "in_progress" && !s.started_at) {
          s.started_at = resumeAt;
        }
      });
      pushEvent("resumed", payload?.note || "Job dilanjutkan");
    }

    if (action === "start_step" || action === "start_steps") {
      if (job.status !== "in_progress") {
        throw new Error("Job harus in_progress untuk start step");
      }
      const ids = Array.from(
        new Set(
          (
            payload?.step_ids?.length
              ? payload.step_ids
              : payload?.step_id
                ? [payload.step_id]
                : []
          )
            .map(String)
            .filter(Boolean)
        )
      );
      if (ids.length === 0) throw new Error("Pilih minimal satu step");
      const startedAt = clientTimeIso(payload?.started_at);
      const startedNames: string[] = [];
      for (const stepId of ids) {
        const step = jobSteps().find((s) => s.id === stepId);
        if (!step) throw new Error(`Step tidak ditemukan: ${stepId}`);
        if (step.status !== "pending") {
          throw new Error(`Step "${step.name}" bukan pending`);
        }
        step.status = "in_progress";
        step.started_at = startedAt;
        step.completed_at = "";
        startedNames.push(step.name);
      }
      pushEvent(
        "step_started",
        startedNames.length === 1
          ? startedNames[0]
          : `Parallel start (${startedNames.length}): ${startedNames.join(", ")}`
      );
    }

    if (action === "complete_step") {
      if (job.status !== "in_progress") throw new Error("Job harus in_progress");
      const stepId = String(payload?.step_id || "");
      const current = stepId
        ? jobSteps().find((s) => s.id === stepId)
        : jobSteps().find((s) => s.status === "in_progress");
      if (!current) throw new Error("Step tidak ditemukan");
      if (current.status !== "in_progress") {
        throw new Error("Hanya step aktif yang bisa diselesaikan");
      }
      const now = Date.now();
      if (
        typeof payload?.duration_sec === "number" &&
        Number.isFinite(payload.duration_sec)
      ) {
        current.duration_sec = Math.max(0, Math.floor(payload.duration_sec));
      } else if (current.started_at) {
        current.duration_sec =
          Math.max(0, current.duration_sec || 0) +
          Math.max(0, Math.floor((now - new Date(current.started_at).getTime()) / 1000));
      }
      current.status = "done";
      current.completed_at = payload?.completed_at || nowIso();
      current.started_at =
        payload?.started_at || current.started_at || current.completed_at;
      pushEvent("step_completed", current.name);

      const stillActive = jobSteps().some((s) => s.status === "in_progress");
      const wantAutoNext =
        payload?.auto_next === true ||
        (payload?.step_mode === "sequential" && payload?.auto_next !== false);
      if (wantAutoNext && !stillActive) {
        const next = jobSteps().find((s) => s.status === "pending");
        if (next) {
          next.status = "in_progress";
          next.started_at = clientTimeIso(
            payload?.next_started_at || payload?.completed_at,
            current.completed_at
          );
          pushEvent("step_started", next.name);
        }
      }
    }

    if (action === "complete") {
      if (!["in_progress", "paused"].includes(job.status)) {
        throw new Error("Job tidak bisa diselesaikan dari status ini");
      }
      if (job.status === "paused" && job.paused_at) {
        const extra = Math.max(
          0,
          Math.floor((Date.now() - new Date(job.paused_at).getTime()) / 1000)
        );
        job.total_paused_sec = (job.total_paused_sec || 0) + extra;
        job.paused_at = "";
      }
      const now = Date.now();
      const snapshots = payload?.step_snapshots || [];
      const byId = new Map(snapshots.map((s) => [s.id, s]));
      jobSteps().forEach((s) => {
        if (s.status !== "done") {
          const snap = byId.get(s.id);
          if (snap && Number.isFinite(snap.duration_sec)) {
            s.duration_sec = Math.max(0, Math.floor(snap.duration_sec));
          } else if (s.status === "in_progress" && s.started_at) {
            s.duration_sec =
              Math.max(0, s.duration_sec || 0) +
              Math.max(
                0,
                Math.floor((now - new Date(s.started_at).getTime()) / 1000)
              );
          }
          s.status = "done";
          s.completed_at = s.completed_at || payload?.completed_at || nowIso();
        }
      });
      job.status = "done";
      job.completed_at = payload?.completed_at || nowIso();
      releaseTechsFromJob(techs, job.id);
      pushEvent("completed", payload?.note || "Job selesai");

      const archivedAt = nowIso();
      const jobStepsSnap = steps.filter((s) => s.job_id === jobId);
      const jobEventsSnap = events.filter((e) => e.job_id === jobId);
      const jobAssigneesSnap = assignees.filter((a) => a.job_id === jobId);
      const jobHandoversSnap = handovers.filter((h) => h.job_id === jobId);
      const jobPartLoansSnap = partLoans.filter((p) => p.job_id === jobId);

      await archiveCompletedJob({
        job: { ...job },
        steps: jobStepsSnap.map((s) => ({ ...s })),
        events: jobEventsSnap.map((e) => ({ ...e })),
        assignees: jobAssigneesSnap.map((a) => ({ ...a })),
        handovers: jobHandoversSnap.map((h) => ({ ...h })),
        part_loans: jobPartLoansSnap.map((p) => ({ ...p })),
        technicians: techs,
        actor,
        archived_at: archivedAt,
      });

      pushAudit(
        "complete",
        `${job.title} · ${job.unit} · archived to completed-jobs.xlsx`
      );

      jobs = jobs.filter((j) => j.id !== jobId);
      steps = steps.filter((s) => s.job_id !== jobId);
      events = events.filter((e) => e.job_id !== jobId);
      assignees = assignees.filter((a) => a.job_id !== jobId);
      handovers = handovers.filter((h) => h.job_id !== jobId);
      partLoans = partLoans.filter((p) => p.job_id !== jobId);

      writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
      writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
      writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
      writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
      writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
      writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
      writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
      await appendJobChangeBackup({
        action: "complete",
        entity: "job",
        entity_id: jobId,
        job_id: jobId,
        summary: `Complete job ${job.title} · ${job.unit}`,
        before: beforeBundle,
        after: {
          job: { ...job },
          meta: { archived_to: "completed-jobs.xlsx" },
        },
        actor,
        at: archivedAt,
      });
      await saveWorkbook(wb);

      return {
        ...enrichJob(
          job,
          techs,
          jobStepsSnap,
          jobEventsSnap,
          jobAssigneesSnap,
          jobHandoversSnap,
          jobPartLoansSnap
        ),
        from_archive: true,
      };
    }

    if (action === "cancel") {
      if (["done", "cancelled"].includes(job.status)) {
        throw new Error("Job sudah selesai/dibatalkan");
      }
      job.status = "cancelled";
      job.completed_at = nowIso();
      releaseTechsFromJob(techs, job.id);
      pushEvent("cancelled", payload?.note || "Job dibatalkan");

      const archivedAt = nowIso();
      const jobStepsSnap = steps.filter((s) => s.job_id === jobId);
      const jobEventsSnap = events.filter((e) => e.job_id === jobId);
      const jobAssigneesSnap = assignees.filter((a) => a.job_id === jobId);
      const jobHandoversSnap = handovers.filter((h) => h.job_id === jobId);
      const jobPartLoansSnap = partLoans.filter((p) => p.job_id === jobId);

      await archiveCancelledJob({
        job: { ...job },
        steps: jobStepsSnap.map((s) => ({ ...s })),
        events: jobEventsSnap.map((e) => ({ ...e })),
        assignees: jobAssigneesSnap.map((a) => ({ ...a })),
        handovers: jobHandoversSnap.map((h) => ({ ...h })),
        part_loans: jobPartLoansSnap.map((p) => ({ ...p })),
        technicians: techs,
        actor,
        archived_at: archivedAt,
      });

      pushAudit(
        "cancel",
        `${job.title} · ${job.unit} · archived to cancelled-jobs.xlsx`
      );

      jobs = jobs.filter((j) => j.id !== jobId);
      steps = steps.filter((s) => s.job_id !== jobId);
      events = events.filter((e) => e.job_id !== jobId);
      assignees = assignees.filter((a) => a.job_id !== jobId);
      handovers = handovers.filter((h) => h.job_id !== jobId);
      partLoans = partLoans.filter((p) => p.job_id !== jobId);

      writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
      writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
      writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
      writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
      writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
      writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
      writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
      await appendJobChangeBackup({
        action: "cancel",
        entity: "job",
        entity_id: jobId,
        job_id: jobId,
        summary: `Cancel job ${job.title} · ${job.unit}`,
        before: beforeBundle,
        after: {
          job: { ...job },
          meta: { archived_to: "cancelled-jobs.xlsx" },
        },
        actor,
        at: archivedAt,
      });
      await saveWorkbook(wb);

      return {
        ...enrichJob(
          job,
          techs,
          jobStepsSnap,
          jobEventsSnap,
          jobAssigneesSnap,
          jobHandoversSnap,
          jobPartLoansSnap
        ),
        from_archive: true,
      };
    }

    pushAudit(
      action,
      `${job.title} · ${job.unit} · status ${job.status}${
        payload?.note ? ` · ${payload.note}` : ""
      }`
    );

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await appendJobChangeBackup({
      action,
      entity: "job",
      entity_id: jobId,
      job_id: jobId,
      summary: `${action} · ${job.title} · status ${job.status}`,
      before: beforeBundle,
      after: buildJobChangeBundle(
        jobId,
        jobs,
        steps,
        assignees,
        handovers,
        partLoans,
        techs
      ),
      actor,
    });
    await saveWorkbook(wb);
    return enrichJob(job, techs, steps, events, assignees, handovers, partLoans);
  });
}

/** Restore workshop state from backup-jobs.xlsx ChangeLog entry (superuser undo). */
export async function undoJobChange(
  changeId: string,
  actor?: AuditActor | null
): Promise<{ ok: true; summary: string }> {
  const entry = await getJobChangeBackup(changeId);
  if (!entry) throw new Error("Entri backup tidak ditemukan");
  if (entry.undone === "1") throw new Error("Entri backup sudah di-undo");

  const before = parseBundle(entry.before_json);
  const after = parseBundle(entry.after_json);

  return withDbLock(async () => {
    const wb = await loadWorkbook();
    let jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    let events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const audits = loadAuditLog(wb);
    let assignees = loadAssignees(wb, jobs);
    let handovers = loadHandovers(wb);
    let partLoans = loadPartLoans(wb);
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);

    const applyTechSnap = (list?: JobChangeBundle["technicians"]) => {
      if (!list) return;
      for (const snap of list) {
        const tech = techs.find((t) => t.id === snap.id);
        if (!tech) continue;
        tech.status = snap.status;
        tech.current_job_id = snap.current_job_id;
      }
    };

    const restoreJobBundle = (bundle: JobChangeBundle) => {
      const jobId = bundle.job?.id || entry.job_id;
      if (!jobId) throw new Error("Backup tidak punya job_id");

      jobs = jobs.filter((j) => j.id !== jobId);
      steps = steps.filter((s) => s.job_id !== jobId);
      assignees = assignees.filter((a) => a.job_id !== jobId);
      handovers = handovers.filter((h) => h.job_id !== jobId);
      partLoans = partLoans.filter((p) => p.job_id !== jobId);

      if (bundle.job) {
        jobs.push({ ...bundle.job });
        steps.push(...(bundle.steps || []).map((s) => ({ ...s })));
        assignees.push(...(bundle.assignees || []).map((a) => ({ ...a })));
        handovers.push(...(bundle.handovers || []).map((h) => ({ ...h })));
        partLoans.push(...(bundle.part_loans || []).map((p) => ({ ...p })));
      }
      applyTechSnap(bundle.technicians);
    };

    if (entry.entity === "job_handover") {
      if (entry.action === "create" && after?.handover) {
        handovers = handovers.filter((h) => h.id !== after.handover!.id);
      } else if (entry.action === "delete" && before?.handover) {
        if (!handovers.some((h) => h.id === before.handover!.id)) {
          handovers.push({ ...before.handover });
        }
      } else if (entry.action === "update" && before?.handover) {
        const idx = handovers.findIndex((h) => h.id === before.handover!.id);
        if (idx >= 0) handovers[idx] = { ...before.handover };
        else handovers.push({ ...before.handover });
      } else {
        throw new Error("Snapshot handover tidak lengkap untuk undo");
      }
    } else if (entry.entity === "job_part_loan") {
      if (entry.action === "create" && after?.part_loan) {
        partLoans = partLoans.filter((p) => p.id !== after.part_loan!.id);
      } else if (entry.action === "delete" && before?.part_loan) {
        if (!partLoans.some((p) => p.id === before.part_loan!.id)) {
          partLoans.push({ ...before.part_loan });
        }
      } else if (entry.action === "update" && before?.part_loan) {
        const idx = partLoans.findIndex((p) => p.id === before.part_loan!.id);
        if (idx >= 0) partLoans[idx] = { ...before.part_loan };
        else partLoans.push({ ...before.part_loan });
      } else {
        throw new Error("Snapshot part loan tidak lengkap untuk undo");
      }
    } else if (entry.entity === "job") {
      if (entry.action === "create") {
        const id = entry.job_id || after?.job?.id;
        if (!id) throw new Error("Tidak ada job untuk di-undo create");
        releaseTechsFromJob(techs, id);
        jobs = jobs.filter((j) => j.id !== id);
        steps = steps.filter((s) => s.job_id !== id);
        events = events.filter((e) => e.job_id !== id);
        assignees = assignees.filter((a) => a.job_id !== id);
        handovers = handovers.filter((h) => h.job_id !== id);
        partLoans = partLoans.filter((p) => p.job_id !== id);
      } else if (
        entry.action === "complete" ||
        entry.action === "cancel" ||
        entry.action === "delete"
      ) {
        if (!before?.job) {
          throw new Error("Snapshot before tidak ada untuk undo");
        }
        // Drop orphan archive copy if present
        if (entry.action === "complete") {
          await takeCompletedJobFromArchive(entry.job_id);
        } else if (entry.action === "cancel") {
          await takeCancelledJobFromArchive(entry.job_id);
        }
        restoreJobBundle(before);
      } else {
        if (!before) throw new Error("Snapshot before tidak ada untuk undo");
        restoreJobBundle(before);
      }
    } else {
      throw new Error(`Entity ${entry.entity} belum didukung undo`);
    }

    const at = nowIso();
    audits.push(
      makeAuditEntry({
        action: "undo",
        entity: entry.entity,
        entity_id: entry.entity_id,
        detail: `Undo ${entry.action}: ${entry.summary}`,
        actor,
        at,
      })
    );

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    writeSheet(wb, SHEETS.handovers, HANDOVER_HEADERS, handovers.map(handoverToRow));
    writeSheet(wb, SHEETS.partLoans, PART_LOAN_HEADERS, partLoans.map(partLoanToRow));
    writeSheet(wb, SHEETS.audit, AUDIT_HEADERS, audits.map(auditToRow));
    await saveWorkbook(wb);
    await markJobChangeBackupUndone(changeId, actor);
    return { ok: true as const, summary: entry.summary };
  });
}

export { listJobChangeBackups } from "./job-change-backup";

function loadAttendance(wb: MysqlWorkbook): Attendance[] {
  return readRows(getSheet(wb, SHEETS.attendance))
    .map(mapAttendance)
    .filter((a) => a.id && a.date);
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Accept YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, or Date. */
function normalizeAttendanceDate(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function formatClockValue(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (raw instanceof Date) {
    // Excel empty/midnight time cells often serialize as 1899-12-30 00:00
    if (raw.getFullYear() < 1901) {
      const hh = String(raw.getHours()).padStart(2, "0");
      const mm = String(raw.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    const hh = String(raw.getHours()).padStart(2, "0");
    const mm = String(raw.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (typeof raw === "number") {
    if (raw === 0) return "00:00";
    if (raw > 0 && raw < 1) {
      const totalMin = Math.round(raw * 24 * 60);
      const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, "0");
      const mm = String(totalMin % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }
  const s = String(raw).trim();
  if (!s) return "";
  if (/12:00:00\s*AM/i.test(s) || /^12:00\s*AM$/i.test(s)) return "00:00";
  if (s.startsWith("1899-12-30")) {
    const iso = s.match(/T(\d{2}):(\d{2})/);
    return iso ? `${iso[1]}:${iso[2]}` : "00:00";
  }
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
  return s.slice(0, 16);
}

/** Clock In 00:00 / 12:00 AM (Excel midnight punch). Empty string = no value. */
function isMidnightClock(checkIn: string): boolean {
  const s = checkIn.trim().toLowerCase();
  if (!s) return false;
  if (/^00:00(:00)?$/.test(s)) return true;
  if (/^12:00(:00)?\s*am$/.test(s)) return true;
  return false;
}

function shouldForceTechOffline(dws: string, checkIn: string): boolean {
  return dws.trim().toUpperCase() === "OFF" || isMidnightClock(checkIn);
}

function deriveAttendanceStatus(input: {
  dws: string;
  absence: string;
  attendanceType: string;
  checkIn: string;
}): AttendanceStatus {
  const abs = input.absence.toLowerCase();
  if (abs.includes("sick") || abs.includes("sakit")) return "sakit";
  if (
    abs.includes("leave") ||
    abs.includes("izin") ||
    abs.includes("break") ||
    abs.includes("cuti")
  ) {
    return "izin";
  }
  if (abs) return "izin";

  if (shouldForceTechOffline(input.dws, input.checkIn)) return "off";

  const att = input.attendanceType.toLowerCase();
  if (att) return "hadir";
  if (input.checkIn && !isMidnightClock(input.checkIn)) return "hadir";

  const dws = input.dws.trim().toUpperCase();
  if (!dws || dws === "OFF") return "off";
  return "hadir";
}

function findTechForAttendance(
  techs: Technician[],
  pernr: string,
  name: string
): Technician | undefined {
  const p = pernr.trim();
  if (p) {
    const byPernr = techs.find((t) => t.sn.trim() === p);
    if (byPernr) return byPernr;
  }
  const n = normalizeName(name);
  if (!n) return undefined;
  return techs.find((t) => normalizeName(t.name) === n);
}

export async function createAttendance(input: {
  id?: string;
  date: string;
  technician_id?: string;
  technician_name: string;
  pernr?: string;
  status: AttendanceStatus;
  dws?: string;
  check_in?: string;
  check_out?: string;
  absence?: string;
  note?: string;
}): Promise<Attendance> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const rows = loadAttendance(wb);
    const requestedId = String(input.id || "").trim();
    if (requestedId) {
      const existing = rows.find((a) => a.id === requestedId);
      if (existing) return existing;
    }
    const date = normalizeAttendanceDate(input.date);
    if (!date) throw new Error("Tanggal wajib diisi");
    const status = input.status;
    const allowed: AttendanceStatus[] = ["hadir", "izin", "sakit", "off", "alpha"];
    if (!allowed.includes(status)) throw new Error("Status tidak valid");

    const tech =
      (input.technician_id
        ? techs.find((t) => t.id === input.technician_id)
        : undefined) ||
      findTechForAttendance(techs, input.pernr || "", input.technician_name);

    const pernr = (input.pernr || tech?.sn || "").trim();
    const name = (input.technician_name || tech?.name || "").trim();
    if (!name) throw new Error("Nama teknisi wajib diisi");

    const dup = rows.find(
      (a) =>
        a.date === date &&
        ((pernr && a.pernr === pernr) ||
          (tech && a.technician_id === tech.id) ||
          normalizeName(a.technician_name) === normalizeName(name))
    );
    if (dup) throw new Error("Data hadir untuk teknisi & tanggal ini sudah ada");

    const row: Attendance = {
      id: requestedId || `A-${uuidv4().slice(0, 8)}`,
      date,
      technician_id: tech?.id || "",
      technician_name: name,
      pernr,
      status,
      dws: (input.dws || "").trim(),
      check_in: (input.check_in || "").trim(),
      check_out: (input.check_out || "").trim(),
      absence: (input.absence || "").trim(),
      note: (input.note || "").trim(),
    };
    rows.push(row);
    writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, rows.map(attendanceToRow));
    await saveWorkbook(wb);
    return row;
  });
}

export async function updateAttendance(
  id: string,
  input: {
    date: string;
    technician_id?: string;
    technician_name: string;
    pernr?: string;
    status: AttendanceStatus;
    dws?: string;
    check_in?: string;
    check_out?: string;
    absence?: string;
    note?: string;
  }
): Promise<Attendance> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const rows = loadAttendance(wb);
    const row = rows.find((a) => a.id === id);
    if (!row) throw new Error("Data hadir tidak ditemukan");

    const date = normalizeAttendanceDate(input.date);
    if (!date) throw new Error("Tanggal wajib diisi");
    const allowed: AttendanceStatus[] = ["hadir", "izin", "sakit", "off", "alpha"];
    if (!allowed.includes(input.status)) throw new Error("Status tidak valid");

    const tech =
      (input.technician_id
        ? techs.find((t) => t.id === input.technician_id)
        : undefined) ||
      findTechForAttendance(techs, input.pernr || "", input.technician_name);

    const pernr = (input.pernr || tech?.sn || "").trim();
    const name = (input.technician_name || tech?.name || "").trim();
    if (!name) throw new Error("Nama teknisi wajib diisi");

    const dup = rows.find(
      (a) =>
        a.id !== id &&
        a.date === date &&
        ((pernr && a.pernr === pernr) ||
          (tech && a.technician_id === tech.id) ||
          normalizeName(a.technician_name) === normalizeName(name))
    );
    if (dup) throw new Error("Data hadir untuk teknisi & tanggal ini sudah ada");

    row.date = date;
    row.technician_id = tech?.id || "";
    row.technician_name = name;
    row.pernr = pernr;
    row.status = input.status;
    row.dws = (input.dws || "").trim();
    row.check_in = (input.check_in || "").trim();
    row.check_out = (input.check_out || "").trim();
    row.absence = (input.absence || "").trim();
    row.note = (input.note || "").trim();

    writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, rows.map(attendanceToRow));
    await saveWorkbook(wb);
    return row;
  });
}

export async function deleteAttendance(id: string): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    let rows = loadAttendance(wb);
    if (!rows.some((a) => a.id === id)) throw new Error("Data hadir tidak ditemukan");
    rows = rows.filter((a) => a.id !== id);
    writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, rows.map(attendanceToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function importAttendanceFromBuffer(
  buffer: ArrayBuffer | Buffer,
  opts?: { syncTechStatus?: boolean }
): Promise<{
  imported: number;
  updated: number;
  unmatched: string[];
  date: string;
  tech_available?: number;
  tech_offline?: number;
}> {
  return withDbLock(async () => {
    const src = new ExcelJS.Workbook();
    const bytes =
      buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.from(buffer);
    // exceljs typings expect Buffer
    await src.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = src.worksheets[0];
    if (!ws) throw new Error("File Excel kosong / tidak ada sheet");

    const found = findSheetHeader(ws, TECH_SN_HEADERS, TECH_NAME_HEADERS);
    let headerRow = found?.headerRow ?? 1;
    let map = found?.headerMap;
    if (!map) {
      map = {};
      ws.getRow(1).eachCell((cell, col) => {
        const key = cellStr(cell.value).trim().toLowerCase();
        if (key) map![key] = col;
      });
      headerRow = 1;
    }

    const col = (...names: string[]) => headerCol(map!, ...names);

    const cPernr = col(...TECH_SN_HEADERS);
    const cName = col(...TECH_NAME_HEADERS);
    const cDate = col("date", "tanggal");
    const cDws = col("dws", "dws text");
    const cClockIn = col("clock in", "jam masuk");
    const cClockOut = col("clock out", "jam keluar");
    const cAbsence = col("absence type text", "absence type", "keterangan absen");
    const cAtt = col("attendance type text", "attendance type");

    if (!cName && !cPernr) {
      throw new Error(
        'Kolom "Name Employee" / "Pernr" / "No. ID Badge" tidak ditemukan di file Excel'
      );
    }

    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const rows = loadAttendance(wb);
    const unmatched: string[] = [];
    const presentTechIds = new Set<string>();
    let imported = 0;
    let updated = 0;
    let primaryDate = "";
    let techAvailable = 0;
    let techOffline = 0;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const pernr = cPernr ? cellStr(row.getCell(cPernr).value).trim() : "";
      const name = cName ? cellStr(row.getCell(cName).value).trim() : "";
      if (!pernr && !name) return;

      const dateRaw = cDate ? row.getCell(cDate).value : "";
      const date = normalizeAttendanceDate(dateRaw) || (cDate ? "" : nowIso().slice(0, 10));
      if (!date) return;
      if (!primaryDate) primaryDate = date;

      const dws = cDws ? cellStr(row.getCell(cDws).value).trim() : "";
      const absence = cAbsence ? cellStr(row.getCell(cAbsence).value).trim() : "";
      const attendanceType = cAtt ? cellStr(row.getCell(cAtt).value).trim() : "";
      const check_in = cClockIn
        ? formatClockValue(row.getCell(cClockIn).value)
        : "";
      const check_out = cClockOut
        ? formatClockValue(row.getCell(cClockOut).value)
        : "";
      const status = deriveAttendanceStatus({
        dws,
        absence,
        attendanceType,
        checkIn: check_in,
      });

      const tech = findTechForAttendance(techs, pernr, name);
      if (!tech) {
        unmatched.push(pernr ? `${pernr} — ${name || "?"}` : name);
      }

      const existing = rows.find(
        (a) =>
          a.date === date &&
          ((pernr && a.pernr === pernr) ||
            (tech && a.technician_id === tech.id) ||
            (name && normalizeName(a.technician_name) === normalizeName(name)))
      );

      if (existing) {
        existing.technician_id = tech?.id || existing.technician_id;
        existing.technician_name = name || tech?.name || existing.technician_name;
        existing.pernr = pernr || tech?.sn || existing.pernr;
        existing.status = status;
        existing.dws = dws;
        existing.check_in = check_in;
        existing.check_out = check_out;
        existing.absence = absence;
        existing.note = attendanceType;
        updated += 1;
      } else {
        rows.push({
          id: `A-${uuidv4().slice(0, 8)}`,
          date,
          technician_id: tech?.id || "",
          technician_name: name || tech?.name || "",
          pernr: pernr || tech?.sn || "",
          status,
          dws,
          check_in,
          check_out,
          absence,
          note: attendanceType,
        });
        imported += 1;
      }

      if (opts?.syncTechStatus && tech && tech.status !== "busy") {
        const forceOffline = shouldForceTechOffline(dws, check_in);
        if (!forceOffline && status === "hadir") {
          tech.status = "available";
          tech.current_job_id = "";
          presentTechIds.add(tech.id);
        } else {
          tech.status = "offline";
          tech.current_job_id = "";
        }
      }
    });

    if (imported + updated === 0) {
      throw new Error("Tidak ada baris data hadir yang bisa diimpor");
    }

    // Teknisi master yang tidak muncul sebagai "hadir" di file → offline
    if (opts?.syncTechStatus) {
      for (const tech of techs) {
        if (tech.status === "busy") continue;
        if (presentTechIds.has(tech.id)) {
          if (tech.status === "available") techAvailable += 1;
          continue;
        }
        if (tech.status !== "offline") {
          tech.status = "offline";
          tech.current_job_id = "";
        }
        techOffline += 1;
      }
    }

    writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, rows.map(attendanceToRow));
    if (opts?.syncTechStatus) {
      writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    }
    await saveWorkbook(wb);
    return {
      imported,
      updated,
      unmatched: [...new Set(unmatched)].slice(0, 50),
      date: primaryDate,
      tech_available: opts?.syncTechStatus ? techAvailable : undefined,
      tech_offline: opts?.syncTechStatus ? techOffline : undefined,
    };
  });
}

/**
 * Meals Request / roster Excel → status board.
 * No. ID Badge (= SN/Pernr) ada di file → available (kecuali busy);
 * tidak ada di file → offline.
 * Juga menulis/meng-update baris Attendance (hadir) untuk yang match.
 */
export async function syncTechnicianPresenceFromBuffer(
  buffer: ArrayBuffer | Buffer,
  opts?: { date?: string }
): Promise<{
  badge_count: number;
  available: number;
  offline: number;
  busy_skipped: number;
  unmatched_badges: string[];
  attendance_upserted: number;
  date: string;
  sheet_used: string;
}> {
  return withDbLock(async () => {
    const src = new ExcelJS.Workbook();
    const bytes =
      buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.from(buffer);
    await src.xlsx.load(bytes as unknown as ExcelJS.Buffer);

    const { badges, namesByBadge, sheetUsed } =
      extractPresenceBadgesFromWorkbook(src);
    if (badges.size === 0) {
      throw new Error(
        'Tidak ada No. ID Badge / Pernr di Excel. Pastikan ada kolom "No. ID Badge" (sheet Formula / shift).'
      );
    }

    const date =
      normalizeAttendanceDate(opts?.date) || nowIso().slice(0, 10);
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const rows = loadAttendance(wb);

    let available = 0;
    let offline = 0;
    let busySkipped = 0;
    let attendanceUpserted = 0;
    const matchedBadgeKeys = new Set<string>();

    for (const tech of techs) {
      const snKey = tech.sn.trim().toLowerCase();
      const inMeals = Boolean(snKey && badges.has(snKey));
      if (inMeals) matchedBadgeKeys.add(snKey);

      if (tech.status === "busy") {
        busySkipped += 1;
        continue;
      }

      if (inMeals) {
        tech.status = "available";
        tech.current_job_id = "";
        available += 1;

        const name =
          namesByBadge.get(snKey) || tech.name || tech.sn;
        const existing = rows.find(
          (a) =>
            a.date === date &&
            ((tech.sn && a.pernr === tech.sn) || a.technician_id === tech.id)
        );
        if (existing) {
          existing.technician_id = tech.id;
          existing.technician_name = name;
          existing.pernr = tech.sn;
          existing.status = "hadir";
          existing.note = existing.note || "meals-request";
        } else {
          rows.push({
            id: `A-${uuidv4().slice(0, 8)}`,
            date,
            technician_id: tech.id,
            technician_name: name,
            pernr: tech.sn,
            status: "hadir",
            dws: "",
            check_in: "",
            check_out: "",
            absence: "",
            note: "meals-request",
          });
        }
        attendanceUpserted += 1;
      } else {
        tech.status = "offline";
        tech.current_job_id = "";
        offline += 1;
      }
    }

    const unmatched = [...badges]
      .filter((b) => !matchedBadgeKeys.has(b))
      .map((b) => {
        const name = namesByBadge.get(b);
        return name ? `${b} — ${name}` : b;
      })
      .slice(0, 50);

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.attendance, ATTENDANCE_HEADERS, rows.map(attendanceToRow));
    await saveWorkbook(wb);

    return {
      badge_count: badges.size,
      available,
      offline,
      busy_skipped: busySkipped,
      unmatched_badges: unmatched,
      attendance_upserted: attendanceUpserted,
      date,
      sheet_used: sheetUsed || "(unknown)",
    };
  });
}

export async function listUsers(): Promise<AppUserPublic[]> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const seeded = await ensureUsers(wb);
    if (seeded) await saveWorkbook(wb);
    return readUsers(wb)
      .map(toPublicUser)
      .sort((a, b) => a.username.localeCompare(b.username));
  });
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<AppUserPublic | null> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const seeded = await ensureUsers(wb);
    const users = readUsers(wb);
    const user = users.find(
      (u) =>
        u.username.toLowerCase() === username.trim().toLowerCase() &&
        u.active === "1"
    );
    if (!user) {
      if (seeded) await saveWorkbook(wb);
      return null;
    }
    const wasPlain = needsPasswordHash(user.password);
    if (!(await verifyPassword(password, user.password))) {
      if (seeded) await saveWorkbook(wb);
      return null;
    }
    let dirty = seeded;
    if (wasPlain) {
      user.password = await hashPassword(password);
      writeSheet(
        wb,
        SHEETS.users,
        USER_HEADERS,
        users.map((u) => (u.id === user.id ? userToRow(user) : userToRow(u)))
      );
      dirty = true;
    }
    if (dirty) await saveWorkbook(wb);
    return toPublicUser(user);
  });
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    await ensureUsers(wb);
    const users = readUsers(wb);
    const user = users.find((item) => item.id === userId && item.active === "1");
    if (!user) throw new Error("User tidak ditemukan atau sudah nonaktif");
    if (!(await verifyPassword(currentPassword, user.password))) {
      throw new Error("Password saat ini salah");
    }
    if (newPassword.length < 6) {
      throw new Error("Password baru minimal 6 karakter");
    }
    if (newPassword === currentPassword) {
      throw new Error("Password baru harus berbeda dari password saat ini");
    }

    user.password = await hashPassword(newPassword);
    writeSheet(wb, SHEETS.users, USER_HEADERS, users.map(userToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function getUserByUsername(
  username: string
): Promise<AppUserPublic | null> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const seeded = await ensureUsers(wb);
    if (seeded) await saveWorkbook(wb);
    const user = readUsers(wb).find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );
    return user ? toPublicUser(user) : null;
  });
}

export async function createUser(input: {
  username: string;
  password: string;
  name?: string;
  level?: UserLevel;
  active?: string;
}): Promise<AppUserPublic> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    await ensureUsers(wb);
    const users = readUsers(wb);
    const username = input.username.trim();
    const password = input.password;
    const name = (input.name || "").trim() || username;
    if (!username || !password) {
      throw new Error("username dan password wajib diisi");
    }
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Username sudah dipakai");
    }
    const user: AppUser = {
      id: `U-${uuidv4().slice(0, 8)}`,
      username,
      password: await hashPassword(password),
      name,
      level: input.level && USER_LEVELS.includes(input.level)
        ? input.level
        : "teknisi",
      active: input.active === "0" ? "0" : "1",
      created_at: nowIso(),
    };
    users.push(user);
    writeSheet(wb, SHEETS.users, USER_HEADERS, users.map(userToRow));
    await saveWorkbook(wb);
    return toPublicUser(user);
  });
}

export async function updateUser(
  userId: string,
  input: {
    username?: string;
    password?: string;
    name?: string;
    level?: UserLevel;
    active?: string;
  }
): Promise<AppUserPublic> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    await ensureUsers(wb);
    const users = readUsers(wb);
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error("User tidak ditemukan");

    if (input.username != null) {
      const username = input.username.trim();
      if (!username) throw new Error("username wajib diisi");
      if (
        users.some(
          (u) =>
            u.id !== userId &&
            u.username.toLowerCase() === username.toLowerCase()
        )
      ) {
        throw new Error("Username sudah dipakai");
      }
      user.username = username;
    }
    if (input.password != null && input.password !== "") {
      user.password = await hashPassword(input.password);
    }
    if (input.name != null) {
      user.name = input.name.trim() || user.username;
    }
    if (input.level && USER_LEVELS.includes(input.level)) {
      if (
        user.level === "superuser" &&
        input.level !== "superuser" &&
        !users.some(
          (u) =>
            u.id !== userId &&
            u.level === "superuser" &&
            u.active === "1"
        )
      ) {
        throw new Error("Minimal satu superuser aktif harus tersisa");
      }
      user.level = input.level;
    }
    if (input.active === "0" || input.active === "1") {
      const activeUsers = users.filter((u) => u.active === "1" && u.id !== userId);
      if (input.active === "0" && activeUsers.length === 0) {
        throw new Error("Minimal satu user aktif harus tersisa");
      }
      if (
        input.active === "0" &&
        user.level === "superuser" &&
        !users.some(
          (u) =>
            u.id !== userId &&
            u.level === "superuser" &&
            u.active === "1"
        )
      ) {
        throw new Error("Minimal satu superuser aktif harus tersisa");
      }
      user.active = input.active;
    }

    writeSheet(wb, SHEETS.users, USER_HEADERS, users.map(userToRow));
    await saveWorkbook(wb);
    return toPublicUser(user);
  });
}

export async function deleteUser(userId: string): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    await ensureUsers(wb);
    const users = readUsers(wb);
    const target = users.find((u) => u.id === userId);
    if (!target) throw new Error("User tidak ditemukan");
    const remaining = users.filter((u) => u.id !== userId);
    if (remaining.filter((u) => u.active === "1").length === 0) {
      throw new Error("Tidak bisa hapus user aktif terakhir");
    }
    if (
      target.level === "superuser" &&
      remaining.filter((u) => u.level === "superuser" && u.active === "1")
        .length === 0
    ) {
      throw new Error("Tidak bisa hapus superuser aktif terakhir");
    }
    writeSheet(wb, SHEETS.users, USER_HEADERS, remaining.map(userToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}
