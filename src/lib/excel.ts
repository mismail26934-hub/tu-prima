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
  DashboardData,
} from "./types";
import { calcElapsedSec, calcProgressPct, nowIso } from "./duration";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "workshop.xlsx");

const SHEETS = {
  technicians: "Technicians",
  jobs: "Jobs",
  assignees: "JobAssignees",
  steps: "JobSteps",
  events: "JobEvents",
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

const TECH_HEADERS = ["id", "name", "skill", "status", "current_job_id", "phone"];
const JOB_HEADERS = [
  "id",
  "title",
  "unit",
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

  const jobs: Job[] = [
    {
      id: "J01",
      title: "Ganti Kampas Rem Depan",
      unit: "Avanza B 1234 ABC",
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
      unit: "Innova D 5678 XYZ",
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
      unit: "Xenia F 9012 LMN",
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
      unit: "Fortuner B 4455 QRS",
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
  writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobs.map(jobToRow));
  writeSheet(wb, SHEETS.assignees, ASSIGNEE_HEADERS, assignees.map(assigneeToRow));
  writeSheet(wb, SHEETS.steps, STEP_HEADERS, steps.map(stepToRow));
  writeSheet(wb, SHEETS.events, EVENT_HEADERS, events.map(eventToRow));
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
      jobs: detailed,
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
  unit: string;
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

    const id = `J${String(jobs.length + 1).padStart(2, "0")}-${uuidv4().slice(0, 4)}`;
    const created_at = nowIso();
    const job: Job = {
      id,
      title: input.title,
      unit: input.unit,
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
    unit: string;
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

    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");

    const title = input.title.trim();
    const unit = input.unit.trim();
    if (!title || !unit) throw new Error("title dan unit wajib diisi");

    job.title = title;
    job.unit = unit;
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
      if (!["queued", "assigned"].includes(job.status)) {
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
      job.status = "assigned";
      pushEvent(
        "assigned",
        `Diassign ke ${selected.map((t) => t.name).join(", ")}`
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
