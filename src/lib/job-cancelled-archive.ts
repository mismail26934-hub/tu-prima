import {
  loadArchiveWb,
  saveArchiveWb,
  readArchiveRows,
  writeArchiveSheet,
  appendArchiveSheet,
  type ArchiveRow,
  type MysqlWorkbook,
  type MysqlSheet,
} from "@/db/archive-store";
import type {
  AuditActor,
  Job,
  JobAssignee,
  JobEvent,
  JobHandover,
  JobPartLoan,
  JobStep,
  JobWithDetails,
  Technician,
} from "@/lib/types";
import { calcElapsedSec, calcProgressPct } from "@/lib/duration";

/** Logical archive name in MySQL (was Excel file). */
export const CANCELLED_JOBS_PATH = "mysql://cancelled";
const ARCHIVE_DB = "cancelled";

const META = [
  "archived_at",
  "archived_by_user_id",
  "archived_by_user_name",
  "archived_by_user_level",
] as const;

const SHEETS = {
  jobs: "CancelledJobs",
  steps: "CancelledSteps",
  events: "CancelledEvents",
  assignees: "CancelledAssignees",
  handovers: "CancelledHandovers",
  partLoans: "CancelledPartLoans",
} as const;

const JOB_HEADERS = [
  ...META,
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

const STEP_HEADERS = [
  ...META,
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

const EVENT_HEADERS = [
  ...META,
  "id",
  "job_id",
  "type",
  "note",
  "created_at",
  "user_id",
  "user_name",
  "user_level",
];

const ASSIGNEE_HEADERS = [
  ...META,
  "id",
  "job_id",
  "technician_id",
  "technician_name",
  "technician_sn",
  "assigned_at",
  "is_lead",
];

const HANDOVER_HEADERS = [
  ...META,
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
  ...META,
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

type Row = ArchiveRow;

export type CancelledJobBundle = {
  job: Job;
  steps: JobStep[];
  events: JobEvent[];
  assignees: JobAssignee[];
  handovers: JobHandover[];
  part_loans: JobPartLoan[];
  archived_at: string;
};









function readRows(ws: MysqlSheet): Row[] {
  return readArchiveRows(ws);
}

function writeSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: string[],
  rows: Row[]
) {
  writeArchiveSheet(wb, name, headers, rows);
}

async function loadArchiveWorkbook(): Promise<MysqlWorkbook> {
  return loadArchiveWb(ARCHIVE_DB);
}

async function saveArchiveWorkbook(wb: MysqlWorkbook) {
  await saveArchiveWb(wb);
}

function appendSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: string[],
  newRows: Row[]
) {
  appendArchiveSheet(wb, name, headers, newRows);
}
function metaFields(
  archived_at: string,
  actor?: AuditActor | null
): Record<(typeof META)[number], string> {
  return {
    archived_at,
    archived_by_user_id: actor?.user_id || "",
    archived_by_user_name: actor?.user_name || "",
    archived_by_user_level: actor?.user_level || "",
  };
}


function mapJobRow(r: Row): Job {
  return {
    id: String(r.id || ""),
    title: String(r.title || ""),
    unit: String(r.unit || ""),
    unit_id: String(r.unit_id || ""),
    description: String(r.description || ""),
    status: String(r.status || "cancelled") as Job["status"],
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

function mapStepRow(r: Row): JobStep {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    name: String(r.name || ""),
    order: Number(r.order || 0),
    status: String(r.status || "done") as JobStep["status"],
    started_at: String(r.started_at || ""),
    completed_at: String(r.completed_at || ""),
    duration_sec: Number(r.duration_sec || 0),
    std_minutes: Number(r.std_minutes || 0),
  };
}

function mapEventRow(r: Row): JobEvent {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    type: String(r.type || "cancelled") as JobEvent["type"],
    note: String(r.note || ""),
    created_at: String(r.created_at || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    user_level: String(r.user_level || ""),
  };
}

function mapAssigneeRow(r: Row): JobAssignee {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    technician_id: String(r.technician_id || ""),
    assigned_at: String(r.assigned_at || ""),
    is_lead: String(r.is_lead || "0") === "1" ? "1" : "0",
  };
}

function mapHandoverRow(r: Row): JobHandover {
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

function mapPartLoanRow(r: Row): JobPartLoan {
  return {
    id: String(r.id || ""),
    job_id: String(r.job_id || ""),
    order: Number(r.order || 0),
    part_name: String(r.part_name || ""),
    status: (String(r.status || "open") === "closed" ? "closed" : "open") as JobPartLoan["status"],
    note: String(r.note || ""),
    user_id: String(r.user_id || ""),
    user_name: String(r.user_name || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function techStubFromAssigneeRow(r: Row): Technician | null {
  const id = String(r.technician_id || "");
  if (!id) return null;
  return {
    id,
    name: String(r.technician_name || id),
    sn: String(r.technician_sn || ""),
    status: "available",
    current_job_id: "",
    phone: "",
  };
}

/** Append cancelled job snapshot to data/cancelled-jobs.xlsx. */
export async function archiveCancelledJob(input: {
  job: Job;
  steps: JobStep[];
  events: JobEvent[];
  assignees: JobAssignee[];
  handovers: JobHandover[];
  part_loans: JobPartLoan[];
  technicians: Technician[];
  actor?: AuditActor | null;
  archived_at: string;
}): Promise<void> {
  const meta = metaFields(input.archived_at, input.actor);
  const techById = new Map(input.technicians.map((t) => [t.id, t]));
  const wb = await loadArchiveWorkbook();

  appendSheet(wb, SHEETS.jobs, JOB_HEADERS, [
    {
      ...meta,
      id: input.job.id,
      title: input.job.title,
      unit: input.job.unit,
      unit_id: input.job.unit_id,
      description: input.job.description,
      status: input.job.status,
      technician_id: input.job.technician_id,
      template_id: input.job.template_id,
      created_at: input.job.created_at,
      started_at: input.job.started_at,
      completed_at: input.job.completed_at,
      paused_at: input.job.paused_at,
      total_paused_sec: input.job.total_paused_sec,
      estimated_minutes: input.job.estimated_minutes,
    },
  ]);

  appendSheet(
    wb,
    SHEETS.steps,
    STEP_HEADERS,
    input.steps.map((s) => ({
      ...meta,
      id: s.id,
      job_id: s.job_id,
      name: s.name,
      order: s.order,
      status: s.status,
      started_at: s.started_at,
      completed_at: s.completed_at,
      duration_sec: s.duration_sec,
      std_minutes: s.std_minutes,
    }))
  );

  appendSheet(
    wb,
    SHEETS.events,
    EVENT_HEADERS,
    input.events.map((e) => ({
      ...meta,
      id: e.id,
      job_id: e.job_id,
      type: e.type,
      note: e.note,
      created_at: e.created_at,
      user_id: e.user_id,
      user_name: e.user_name,
      user_level: e.user_level,
    }))
  );

  appendSheet(
    wb,
    SHEETS.assignees,
    ASSIGNEE_HEADERS,
    input.assignees.map((a) => {
      const tech = techById.get(a.technician_id);
      return {
        ...meta,
        id: a.id,
        job_id: a.job_id,
        technician_id: a.technician_id,
        technician_name: tech?.name || "",
        technician_sn: tech?.sn || "",
        assigned_at: a.assigned_at,
        is_lead: a.is_lead,
      };
    })
  );

  appendSheet(
    wb,
    SHEETS.handovers,
    HANDOVER_HEADERS,
    input.handovers.map((h) => ({
      ...meta,
      id: h.id,
      job_id: h.job_id,
      order: h.order,
      title: h.title,
      done: h.done,
      note: h.note,
      user_id: h.user_id,
      user_name: h.user_name,
      updated_at: h.updated_at,
    }))
  );

  appendSheet(
    wb,
    SHEETS.partLoans,
    PART_LOAN_HEADERS,
    input.part_loans.map((p) => ({
      ...meta,
      id: p.id,
      job_id: p.job_id,
      order: p.order,
      part_name: p.part_name,
      status: p.status,
      note: p.note,
      user_id: p.user_id,
      user_name: p.user_name,
      updated_at: p.updated_at,
    }))
  );

  await saveArchiveWorkbook(wb);
}

function readAllBundles(wb: MysqlWorkbook): CancelledJobBundle[] {
  const jobRows = wb.getWorksheet(SHEETS.jobs)
    ? readRows(wb.getWorksheet(SHEETS.jobs)!)
    : [];
  const stepRows = wb.getWorksheet(SHEETS.steps)
    ? readRows(wb.getWorksheet(SHEETS.steps)!)
    : [];
  const eventRows = wb.getWorksheet(SHEETS.events)
    ? readRows(wb.getWorksheet(SHEETS.events)!)
    : [];
  const assigneeRows = wb.getWorksheet(SHEETS.assignees)
    ? readRows(wb.getWorksheet(SHEETS.assignees)!)
    : [];
  const handoverRows = wb.getWorksheet(SHEETS.handovers)
    ? readRows(wb.getWorksheet(SHEETS.handovers)!)
    : [];
  const partLoanRows = wb.getWorksheet(SHEETS.partLoans)
    ? readRows(wb.getWorksheet(SHEETS.partLoans)!)
    : [];

  return jobRows
    .map((r) => {
      const job = mapJobRow(r);
      if (!job.id) return null;
      const jobId = job.id;
      return {
        job,
        archived_at: String(r.archived_at || job.completed_at || ""),
        steps: stepRows.filter((s) => String(s.job_id) === jobId).map(mapStepRow),
        events: eventRows
          .filter((e) => String(e.job_id) === jobId)
          .map(mapEventRow),
        assignees: assigneeRows
          .filter((a) => String(a.job_id) === jobId)
          .map(mapAssigneeRow),
        handovers: handoverRows
          .filter((h) => String(h.job_id) === jobId)
          .map(mapHandoverRow),
        part_loans: partLoanRows
          .filter((p) => String(p.job_id) === jobId)
          .map(mapPartLoanRow),
      } satisfies CancelledJobBundle;
    })
    .filter((b): b is CancelledJobBundle => Boolean(b))
    .sort((a, b) =>
      (b.job.completed_at || b.archived_at).localeCompare(
        a.job.completed_at || a.archived_at
      )
    );
}

export async function listCancelledJobDetails(
  liveTechs: Technician[] = []
): Promise<JobWithDetails[]> {
  const wb = await loadArchiveWorkbook();
  const bundles = readAllBundles(wb);
  const techById = new Map(liveTechs.map((t) => [t.id, t]));

  // Also build stubs from assignee archive rows for display
  const assigneeSheet = wb.getWorksheet(SHEETS.assignees);
  const assigneeRows = assigneeSheet ? readRows(assigneeSheet) : [];

  return bundles.map((b) => {
    const stubs = assigneeRows
      .filter((r) => String(r.job_id) === b.job.id)
      .map(techStubFromAssigneeRow)
      .filter((t): t is Technician => Boolean(t));
    const technicians = b.assignees
      .map((a) => techById.get(a.technician_id) || stubs.find((s) => s.id === a.technician_id))
      .filter((t): t is Technician => Boolean(t));
    const steps = b.steps.slice().sort((a, c) => a.order - c.order);
    const current_steps = steps.filter((s) => s.status === "in_progress");
    return {
      ...b.job,
      technician:
        technicians.find((t) => t.id === b.job.technician_id) ||
        technicians[0] ||
        null,
      technicians,
      steps,
      events: b.events
        .slice()
        .sort((a, c) => a.created_at.localeCompare(c.created_at)),
      handovers: b.handovers.slice().sort((a, c) => a.order - c.order),
      part_loans: b.part_loans.slice().sort((a, c) => a.order - c.order),
      elapsed_sec: calcElapsedSec(b.job),
      progress_pct: calcProgressPct(steps),
      current_step: current_steps[0] || null,
      current_steps,
      from_archive: true,
    };
  });
}

/** Load one cancelled job and remove it from the archive file. */
export async function takeCancelledJobFromArchive(
  jobId: string
): Promise<CancelledJobBundle | null> {
  const wb = await loadArchiveWorkbook();
  const bundles = readAllBundles(wb);
  const found = bundles.find((b) => b.job.id === jobId);
  if (!found) return null;

  const keep = (rows: Row[], id: string) =>
    rows.filter((r) => String(r.job_id || r.id) !== id);
  // For jobs sheet, filter by id; for children by job_id
  const jobRows = wb.getWorksheet(SHEETS.jobs)
    ? readRows(wb.getWorksheet(SHEETS.jobs)!).filter(
        (r) => String(r.id) !== jobId
      )
    : [];
  writeSheet(wb, SHEETS.jobs, JOB_HEADERS, jobRows);

  const rewriteChild = (sheet: string, headers: string[]) => {
    const ws = wb.getWorksheet(sheet);
    const rows = ws ? keep(readRows(ws), jobId) : [];
    writeSheet(wb, sheet, headers, rows);
  };
  rewriteChild(SHEETS.steps, STEP_HEADERS);
  rewriteChild(SHEETS.events, EVENT_HEADERS);
  rewriteChild(SHEETS.assignees, ASSIGNEE_HEADERS);
  rewriteChild(SHEETS.handovers, HANDOVER_HEADERS);
  rewriteChild(SHEETS.partLoans, PART_LOAN_HEADERS);

  await saveArchiveWorkbook(wb);
  return found;
}
