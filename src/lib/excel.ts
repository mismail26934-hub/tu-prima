import path from "path";
import fs from "fs";
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
} from "./types";
import { calcElapsedSec, calcProgressPct, nowIso } from "./duration";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "workshop.xlsx");

const SHEETS = {
  technicians: "Technicians",
  units: "Units",
  jobs: "Jobs",
  assignees: "JobAssignees",
  steps: "JobSteps",
  events: "JobEvents",
  attendance: "Attendance",
  users: "Users",
} as const;

type Row = Record<string, string | number>;

/** Serialize all Excel read/write to avoid Windows file races. */
let dbQueue: Promise<unknown> = Promise.resolve();

function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbQueue.then(fn, fn);
  dbQueue = run.then(
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

async function loadWorkbook(): Promise<ExcelJS.Workbook> {
  ensureDataDir();
  const wb = new ExcelJS.Workbook();
  if (!fs.existsSync(DB_PATH)) {
    await createSeedWorkbook(wb);
    await atomicWrite(wb);
    return wb;
  }
  await wb.xlsx.readFile(DB_PATH);
  return wb;
}

async function atomicWrite(wb: ExcelJS.Workbook) {
  ensureDataDir();
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await wb.xlsx.writeFile(tmp);
  try {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    fs.renameSync(tmp, DB_PATH);
  } catch {
    fs.copyFileSync(tmp, DB_PATH);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

async function saveWorkbook(wb: ExcelJS.Workbook) {
  await atomicWrite(wb);
}

function getSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  return wb.getWorksheet(name) ?? wb.addWorksheet(name);
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

function writeSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: Row[]
) {
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(name);
  ws.addRow(headers);
  rows.forEach((r) => {
    ws.addRow(headers.map((h) => (r[h] == null ? "" : r[h])));
  });
  ws.getRow(1).font = { bold: true };
}

function mapTechnician(r: Row): Technician {
  return {
    id: String(r.id || ""),
    name: String(r.name || ""),
    skill: String(r.skill || ""),
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
  };
}

function mapEvent(r: Row): JobEvent {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    type: String(r.type || "created") as JobEventType,
    note: String(r.note || ""),
    created_at: String(r.created_at || ""),
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
  return {
    id: String(r.id || ""),
    username: String(r.username || "").trim(),
    password: String(r.password || ""),
    name: String(r.name || "").trim(),
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
  return { ...s, order: s.order, duration_sec: s.duration_sec };
}

function eventToRow(e: JobEvent): Row {
  return { ...e };
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

const TECH_HEADERS = ["id", "name", "skill", "status", "current_job_id", "phone"];
const UNIT_HEADERS = ["id", "code", "name", "active"];
const JOB_HEADERS = [
  "id",
  "title",
  "unit",
  "unit_id",
  "description",
  "status",
  "technician_id",
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
];
const EVENT_HEADERS = ["id", "job_id", "type", "note", "created_at"];
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
const USER_HEADERS = ["id", "username", "password", "name", "active", "created_at"];

/** Ensure Users sheet exists; seed default admin if empty. Returns true if workbook mutated. */
function ensureUsers(wb: ExcelJS.Workbook): boolean {
  const existing = readRows(getSheet(wb, SHEETS.users))
    .map(mapUser)
    .filter((u) => u.id && u.username);
  if (existing.length > 0) return false;
  writeSheet(wb, SHEETS.users, USER_HEADERS, [userToRow(defaultSeedUser())]);
  return true;
}

function readUsers(wb: ExcelJS.Workbook): AppUser[] {
  return readRows(getSheet(wb, SHEETS.users))
    .map(mapUser)
    .filter((u) => u.id && u.username);
}

/** Ensure JobAssignees exists; migrate from Jobs.technician_id if empty. */
function loadAssignees(
  wb: ExcelJS.Workbook,
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

function loadUnits(wb: ExcelJS.Workbook, jobs: Job[]): Unit[] {
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
async function createSeedWorkbook(wb: ExcelJS.Workbook) {
  const now = nowIso();
  const techs: Technician[] = [
    { id: "T01", name: "Andi Pratama", skill: "Mesin & Rem", status: "busy", current_job_id: "J01", phone: "0812-1111-0001" },
    { id: "T02", name: "Budi Santoso", skill: "Kelistrikan", status: "busy", current_job_id: "J01", phone: "0812-1111-0002" },
    { id: "T03", name: "Citra Dewi", skill: "Body & Cat", status: "available", current_job_id: "", phone: "0812-1111-0003" },
    { id: "T04", name: "Dedi Kurnia", skill: "AC & Cooling", status: "busy", current_job_id: "J02", phone: "0812-1111-0004" },
    { id: "T05", name: "Eko Wijaya", skill: "General Service", status: "offline", current_job_id: "", phone: "0812-1111-0005" },
    { id: "T06", name: "Fajar Nugroho", skill: "Mesin Diesel", status: "available", current_job_id: "", phone: "0812-1111-0006" },
  ];

  const started1 = new Date(Date.now() - 85 * 60 * 1000).toISOString();
  const started2 = new Date(Date.now() - 32 * 60 * 1000).toISOString();
  const step2Start = new Date(Date.now() - 40 * 60 * 1000).toISOString();

  const units: Unit[] = [
    { id: "U01", code: "AVZ-1234", name: "Avanza B 1234 ABC", active: "1" },
    { id: "U02", code: "INV-5678", name: "Innova D 5678 XYZ", active: "1" },
    { id: "U03", code: "XEN-9012", name: "Xenia F 9012 LMN", active: "1" },
    { id: "U04", code: "FRT-4455", name: "Fortuner B 4455 QRS", active: "1" },
    { id: "U05", code: "E448", name: "GOH Unit Rental", active: "1" },
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
      created_at: now,
      started_at: "",
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: 100,
    },
  ];

  const steps: JobStep[] = [
    { id: "S01", job_id: "J01", name: "Diagnosis", order: 1, status: "done", started_at: started1, completed_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(), duration_sec: 900 },
    { id: "S02", job_id: "J01", name: "Bongkar & Ganti Sparepart", order: 2, status: "in_progress", started_at: step2Start, completed_at: "", duration_sec: 0 },
    { id: "S03", job_id: "J01", name: "Pasang & Test Rem", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S04", job_id: "J01", name: "QC & Serah Terima", order: 4, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S05", job_id: "J02", name: "Cek Tekanan Freon", order: 1, status: "done", started_at: started2, completed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), duration_sec: 720 },
    { id: "S06", job_id: "J02", name: "Isi Freon / Perbaiki Compressor", order: 2, status: "in_progress", started_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(), completed_at: "", duration_sec: 0 },
    { id: "S07", job_id: "J02", name: "Test Pendinginan", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S08", job_id: "J03", name: "Ganti Oli & Filter", order: 1, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S09", job_id: "J03", name: "Ganti Busi", order: 2, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S10", job_id: "J03", name: "Cek Kelistrikan", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S11", job_id: "J03", name: "QC Final", order: 4, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S12", job_id: "J04", name: "Diagnosis Starter", order: 1, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S13", job_id: "J04", name: "Perbaikan / Ganti", order: 2, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
    { id: "S14", job_id: "J04", name: "Test Start Engine", order: 3, status: "pending", started_at: "", completed_at: "", duration_sec: 0 },
  ];

  const events: JobEvent[] = [
    { id: uuidv4(), job_id: "J01", type: "created", note: "Job dibuat", created_at: jobs[0].created_at },
    { id: uuidv4(), job_id: "J01", type: "assigned", note: "Diassign ke Andi Pratama, Budi Santoso", created_at: jobs[0].created_at },
    { id: uuidv4(), job_id: "J01", type: "started", note: "Pekerjaan dimulai", created_at: started1 },
    { id: uuidv4(), job_id: "J01", type: "step_completed", note: "Diagnosis selesai", created_at: steps[0].completed_at },
    { id: uuidv4(), job_id: "J01", type: "step_started", note: "Bongkar & Ganti Sparepart", created_at: step2Start },
    { id: uuidv4(), job_id: "J02", type: "created", note: "Job dibuat", created_at: jobs[1].created_at },
    { id: uuidv4(), job_id: "J02", type: "assigned", note: "Diassign ke Dedi Kurnia", created_at: jobs[1].created_at },
    { id: uuidv4(), job_id: "J02", type: "started", note: "Pekerjaan dimulai", created_at: started2 },
    { id: uuidv4(), job_id: "J02", type: "paused", note: "Tunggu sparepart", created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString() },
    { id: uuidv4(), job_id: "J02", type: "resumed", note: "Lanjut pekerjaan", created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    { id: uuidv4(), job_id: "J03", type: "created", note: "Job dibuat", created_at: now },
    { id: uuidv4(), job_id: "J04", type: "created", note: "Job dibuat", created_at: now },
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
}

function enrichJob(
  job: Job,
  techs: Technician[],
  steps: JobStep[],
  events: JobEvent[],
  assignees: JobAssignee[] = []
): JobWithDetails {
  const jobSteps = steps
    .filter((s) => s.job_id === job.id)
    .sort((a, b) => a.order - b.order);
  const jobEvents = events
    .filter((e) => e.job_id === job.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

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
  const current_step = jobSteps.find((s) => s.status === "in_progress") || null;
  return {
    ...job,
    technician,
    technicians,
    steps: jobSteps,
    events: jobEvents,
    elapsed_sec: calcElapsedSec(job),
    progress_pct: calcProgressPct(jobSteps),
    current_step,
  };
}

export async function getDashboard(): Promise<DashboardData> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const assignees = loadAssignees(wb, jobs);
    const hadUnits = readRows(getSheet(wb, SHEETS.units)).length > 0;
    const units = loadUnits(wb, jobs);
    const usersSeeded = ensureUsers(wb);
    if ((!hadUnits && units.length > 0) || usersSeeded) {
      if (!hadUnits && units.length > 0) {
        writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
        writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
      }
      await saveWorkbook(wb);
    }

    const detailed = jobs.map((j) => enrichJob(j, techs, steps, events, assignees));
    const today = new Date().toISOString().slice(0, 10);
    const doneToday = detailed.filter(
      (j) => j.status === "done" && j.completed_at.startsWith(today)
    );
    const avg =
      doneToday.length === 0
        ? 0
        : Math.round(
            doneToday.reduce((sum, j) => sum + j.elapsed_sec, 0) / doneToday.length
          );

    return {
      technicians: techs,
      units,
      jobs: detailed,
      attendance: readRows(getSheet(wb, SHEETS.attendance))
        .map(mapAttendance)
        .filter((a) => a.id && a.date)
        .sort((a, b) =>
          b.date.localeCompare(a.date) ||
          a.technician_name.localeCompare(b.technician_name)
        ),
      summary: {
        available: techs.filter((t) => t.status === "available").length,
        busy: techs.filter((t) => t.status === "busy").length,
        offline: techs.filter((t) => t.status === "offline").length,
        active_jobs: detailed.filter((j) =>
          ["in_progress", "paused", "assigned"].includes(j.status)
        ).length,
        queued_jobs: detailed.filter((j) => j.status === "queued").length,
        done_today: doneToday.length,
        avg_duration_sec: avg,
      },
    };
  });
}

export async function createJob(input: {
  title: string;
  unit_id: string;
  description?: string;
  estimated_minutes?: number;
  steps?: string[];
}): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const units = loadUnits(wb, jobs);

    const unit = units.find((u) => u.id === input.unit_id && u.active === "1");
    if (!unit) throw new Error("Unit tidak ditemukan / nonaktif");

    const id = `J${String(jobs.length + 1).padStart(2, "0")}-${uuidv4().slice(0, 4)}`;
    const created_at = nowIso();
    const job: Job = {
      id,
      title: input.title,
      unit: unitLabel(unit),
      unit_id: unit.id,
      description: input.description || "",
      status: "queued",
      technician_id: "",
      created_at,
      started_at: "",
      completed_at: "",
      paused_at: "",
      total_paused_sec: 0,
      estimated_minutes: input.estimated_minutes || 60,
    };
    jobs.push(job);

    const defaultSteps =
      input.steps && input.steps.length
        ? input.steps
        : ["Diagnosis", "Perbaikan", "Test & QC"];
    defaultSteps.forEach((name, i) => {
      steps.push({
        id: uuidv4(),
        job_id: id,
        name,
        order: i + 1,
        status: "pending",
        started_at: "",
        completed_at: "",
        duration_sec: 0,
      });
    });

    events.push({
      id: uuidv4(),
      job_id: id,
      type: "created",
      note: "Job dibuat",
      created_at,
    });

    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
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
  }
): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const assignees = loadAssignees(wb, jobs);
    const units = loadUnits(wb, jobs);

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

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
      steps = steps.filter((s) => s.job_id !== jobId);
      input.steps.forEach((name, i) => {
        steps.push({
          id: uuidv4(),
          job_id: jobId,
          name,
          order: i + 1,
          status: "pending",
          started_at: "",
          completed_at: "",
          duration_sec: 0,
        });
      });
    }

    events.push({
      id: uuidv4(),
      job_id: jobId,
      type: "updated",
      note: "Job diubah",
      created_at: nowIso(),
    });

    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    await saveWorkbook(wb);
    return enrichJob(job, techs, steps, events, assignees);
  });
}

export async function deleteJob(jobId: string): Promise<{ ok: true }> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    let jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    let steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    let events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    let assignees = loadAssignees(wb, jobs);

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    releaseTechsFromJob(techs, jobId);
    jobs = jobs.filter((j) => j.id !== jobId);
    steps = steps.filter((s) => s.job_id !== jobId);
    events = events.filter((e) => e.job_id !== jobId);
    assignees = assignees.filter((a) => a.job_id !== jobId);

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}

export async function createUnit(input: {
  code: string;
  name: string;
}): Promise<Unit> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const units = loadUnits(wb, jobs);
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) throw new Error("code dan name wajib diisi");
    if (units.some((u) => u.code.toUpperCase() === code)) {
      throw new Error("Nomor unit sudah dipakai");
    }
    const unit: Unit = { id: `U-${uuidv4().slice(0, 8)}`, code, name, active: "1" };
    units.push(unit);
    writeSheet(wb, SHEETS.units, UNIT_HEADERS, units.map(unitToRow));
    await saveWorkbook(wb);
    return unit;
  });
}

export async function updateUnit(
  unitId: string,
  input: { code: string; name: string; active?: string }
): Promise<Unit> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const units = loadUnits(wb, jobs);
    const unit = units.find((u) => u.id === unitId);
    if (!unit) throw new Error("Unit not found");
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) throw new Error("code dan name wajib diisi");
    if (units.some((u) => u.id !== unitId && u.code.toUpperCase() === code)) {
      throw new Error("Nomor unit sudah dipakai");
    }
    unit.code = code;
    unit.name = name;
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
  name: string;
  skill: string;
  phone?: string;
  status?: Exclude<TechnicianStatus, "busy">;
}): Promise<Technician> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const name = input.name.trim();
    const skill = input.skill.trim();
    const phone = (input.phone || "").trim();
    if (!name || !skill || !phone) {
      throw new Error("nama, SN KPC, dan telepon wajib diisi");
    }
    const status: TechnicianStatus =
      input.status === "offline" ? "offline" : "available";
    const tech: Technician = {
      id: `T-${uuidv4().slice(0, 8)}`,
      name,
      skill,
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

    const headerRow = ws.getRow(1);
    const headerMap: Record<string, number> = {};
    headerRow.eachCell((cell, col) => {
      const key = cellStr(cell.value).trim().toLowerCase();
      if (key) headerMap[key] = col;
    });

    const col = (...names: string[]) => {
      for (const n of names) {
        const c = headerMap[n.toLowerCase()];
        if (c) return c;
      }
      return 0;
    };

    const cName = col("name", "nama", "name employee", "nama karyawan");
    const cSkill = col(
      "skill",
      "sn kpc",
      "sn",
      "pernr",
      "nik",
      "kpc"
    );
    const cPhone = col("phone", "telepon", "telp", "hp", "no hp", "no. hp");
    const cStatus = col("status");

    if (!cName || !cSkill) {
      throw new Error(
        'Kolom wajib tidak ditemukan. Butuh header "Nama" dan "SN KPC" (atau Pernr/Skill).'
      );
    }

    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const skipped: string[] = [];
    let imported = 0;
    let updated = 0;
    let changed = false;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = cellStr(row.getCell(cName).value).trim();
      const skill = cellStr(row.getCell(cSkill).value).trim();
      const phone = cPhone ? cellStr(row.getCell(cPhone).value).trim() : "";
      const statusRaw = cStatus
        ? cellStr(row.getCell(cStatus).value).trim()
        : "";
      if (!name && !skill) return;
      if (!name || !skill) {
        skipped.push(
          `Baris ${rowNumber}: nama dan SN KPC wajib (${name || "?"} / ${skill || "?"})`
        );
        return;
      }

      const status = normalizeTechStatus(statusRaw);
      const existing = techs.find(
        (t) => t.skill.trim().toLowerCase() === skill.toLowerCase()
      );

      if (existing) {
        existing.name = name;
        existing.skill = skill;
        if (phone) existing.phone = phone;
        if (status && existing.status !== "busy") {
          existing.status = status;
          existing.current_job_id = "";
        }
        updated += 1;
        changed = true;
        return;
      }

      if (!phone) {
        skipped.push(`Baris ${rowNumber}: ${name} — telepon wajib untuk data baru`);
        return;
      }

      techs.push({
        id: `T-${uuidv4().slice(0, 8)}`,
        name,
        skill,
        phone,
        status: status || "available",
        current_job_id: "",
      });
      imported += 1;
      changed = true;
    });

    if (!changed && skipped.length === 0) {
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
    };
  });
}

export async function updateTechnician(
  techId: string,
  input: {
    name: string;
    skill: string;
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
    const skill = input.skill.trim();
    const phone = (input.phone ?? tech.phone).trim();
    if (!name || !skill || !phone) {
      throw new Error("nama, SN KPC, dan telepon wajib diisi");
    }
    tech.name = name;
    tech.skill = skill;
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
  | "complete_step"
  | "complete"
  | "cancel";

export async function jobAction(
  jobId: string,
  action: JobAction,
  payload?: {
    technician_id?: string;
    technician_ids?: string[];
    note?: string;
  }
): Promise<JobWithDetails> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const jobs = readRows(getSheet(wb, SHEETS.jobs)).map(mapJob);
    const steps = readRows(getSheet(wb, SHEETS.steps)).map(mapStep);
    const events = readRows(getSheet(wb, SHEETS.events)).map(mapEvent);
    let assignees = loadAssignees(wb, jobs);

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    const pushEvent = (type: JobEventType, note: string) => {
      events.push({ id: uuidv4(), job_id: jobId, type, note, created_at: nowIso() });
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
      job.started_at = nowIso();
      job.paused_at = "";
      const first = jobSteps().find((s) => s.status === "pending");
      if (first) {
        first.status = "in_progress";
        first.started_at = nowIso();
        pushEvent("step_started", first.name);
      }
      pushEvent("started", payload?.note || "Pekerjaan dimulai");
    }

    if (action === "pause") {
      if (job.status !== "in_progress") throw new Error("Hanya job in_progress yang bisa di-pause");
      job.status = "paused";
      job.paused_at = nowIso();
      pushEvent("paused", payload?.note || "Job dipause");
    }

    if (action === "resume") {
      if (job.status !== "paused") throw new Error("Hanya job paused yang bisa di-resume");
      const pausedAt = job.paused_at ? new Date(job.paused_at).getTime() : Date.now();
      const extra = Math.max(0, Math.floor((Date.now() - pausedAt) / 1000));
      job.total_paused_sec = (job.total_paused_sec || 0) + extra;
      job.paused_at = "";
      job.status = "in_progress";
      pushEvent("resumed", payload?.note || "Job dilanjutkan");
    }

    if (action === "complete_step") {
      if (job.status !== "in_progress") throw new Error("Job harus in_progress");
      const current = jobSteps().find((s) => s.status === "in_progress");
      if (!current) throw new Error("Tidak ada step aktif");
      current.status = "done";
      current.completed_at = nowIso();
      if (current.started_at) {
        current.duration_sec = Math.max(
          0,
          Math.floor((Date.now() - new Date(current.started_at).getTime()) / 1000)
        );
      }
      pushEvent("step_completed", current.name);
      const next = jobSteps().find((s) => s.status === "pending");
      if (next) {
        next.status = "in_progress";
        next.started_at = nowIso();
        pushEvent("step_started", next.name);
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
      jobSteps().forEach((s) => {
        if (s.status !== "done") {
          if (s.status === "in_progress" && s.started_at) {
            s.duration_sec = Math.max(
              0,
              Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000)
            );
          }
          s.status = "done";
          s.completed_at = s.completed_at || nowIso();
        }
      });
      job.status = "done";
      job.completed_at = nowIso();
      releaseTechsFromJob(techs, job.id);
      pushEvent("completed", payload?.note || "Job selesai");
    }

    if (action === "cancel") {
      if (["done", "cancelled"].includes(job.status)) {
        throw new Error("Job sudah selesai/dibatalkan");
      }
      job.status = "cancelled";
      job.completed_at = nowIso();
      releaseTechsFromJob(techs, job.id);
      pushEvent("cancelled", payload?.note || "Job dibatalkan");
    }

    writeSheet(wb, SHEETS.technicians, TECH_HEADERS, techs.map(techToRow));
    writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
    writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
    writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
    writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
    await saveWorkbook(wb);
    return enrichJob(job, techs, steps, events, assignees);
  });
}

function loadAttendance(wb: ExcelJS.Workbook): Attendance[] {
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
    const byPernr = techs.find((t) => t.skill.trim() === p);
    if (byPernr) return byPernr;
  }
  const n = normalizeName(name);
  if (!n) return undefined;
  return techs.find((t) => normalizeName(t.name) === n);
}

export async function createAttendance(input: {
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

    const pernr = (input.pernr || tech?.skill || "").trim();
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
      id: `A-${uuidv4().slice(0, 8)}`,
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

    const pernr = (input.pernr || tech?.skill || "").trim();
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

    const headerRow = ws.getRow(1);
    const headerMap: Record<string, number> = {};
    headerRow.eachCell((cell, col) => {
      const key = cellStr(cell.value).trim().toLowerCase();
      if (key) headerMap[key] = col;
    });

    const col = (...names: string[]) => {
      for (const n of names) {
        const c = headerMap[n.toLowerCase()];
        if (c) return c;
      }
      return 0;
    };

    const cPernr = col("pernr", "sn kpc", "sn", "nik");
    const cName = col("name employee", "name", "nama", "nama karyawan");
    const cDate = col("date", "tanggal");
    const cDws = col("dws", "dws text");
    const cClockIn = col("clock in", "jam masuk");
    const cClockOut = col("clock out", "jam keluar");
    const cAbsence = col("absence type text", "absence type", "keterangan absen");
    const cAtt = col("attendance type text", "attendance type");

    if (!cName && !cPernr) {
      throw new Error(
        'Kolom "Name Employee" / "Pernr" tidak ditemukan di file Excel'
      );
    }

    const wb = await loadWorkbook();
    const techs = readRows(getSheet(wb, SHEETS.technicians)).map(mapTechnician);
    const rows = loadAttendance(wb);
    const unmatched: string[] = [];
    let imported = 0;
    let updated = 0;
    let primaryDate = "";

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const pernr = cPernr ? cellStr(row.getCell(cPernr).value).trim() : "";
      const name = cName ? cellStr(row.getCell(cName).value).trim() : "";
      if (!pernr && !name) return;

      const dateRaw = cDate ? row.getCell(cDate).value : "";
      const date = normalizeAttendanceDate(dateRaw);
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
        existing.pernr = pernr || tech?.skill || existing.pernr;
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
          pernr: pernr || tech?.skill || "",
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
        tech.status =
          forceOffline || status !== "hadir" ? "offline" : "available";
        tech.current_job_id = "";
      }
    });

    if (imported + updated === 0) {
      throw new Error("Tidak ada baris data hadir yang bisa diimpor");
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
    };
  });
}

export async function listUsers(): Promise<AppUserPublic[]> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    const seeded = ensureUsers(wb);
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
    const seeded = ensureUsers(wb);
    if (seeded) await saveWorkbook(wb);
    const user = readUsers(wb).find(
      (u) =>
        u.username.toLowerCase() === username.trim().toLowerCase() &&
        u.password === password &&
        u.active === "1"
    );
    return user ? toPublicUser(user) : null;
  });
}

export async function createUser(input: {
  username: string;
  password: string;
  name?: string;
  active?: string;
}): Promise<AppUserPublic> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    ensureUsers(wb);
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
      password,
      name,
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
    active?: string;
  }
): Promise<AppUserPublic> {
  return withDbLock(async () => {
    const wb = await loadWorkbook();
    ensureUsers(wb);
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
      user.password = input.password;
    }
    if (input.name != null) {
      user.name = input.name.trim() || user.username;
    }
    if (input.active === "0" || input.active === "1") {
      const activeUsers = users.filter((u) => u.active === "1" && u.id !== userId);
      if (input.active === "0" && activeUsers.length === 0) {
        throw new Error("Minimal satu user aktif harus tersisa");
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
    ensureUsers(wb);
    const users = readUsers(wb);
    const target = users.find((u) => u.id === userId);
    if (!target) throw new Error("User tidak ditemukan");
    const remaining = users.filter((u) => u.id !== userId);
    if (remaining.filter((u) => u.active === "1").length === 0) {
      throw new Error("Tidak bisa hapus user aktif terakhir");
    }
    writeSheet(wb, SHEETS.users, USER_HEADERS, remaining.map(userToRow));
    await saveWorkbook(wb);
    return { ok: true };
  });
}
