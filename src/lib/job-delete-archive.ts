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
  Technician,
} from "@/lib/types";

/** Logical archive name in MySQL (was Excel file). */
export const DELETED_JOBS_PATH = "mysql://deleted";
const ARCHIVE_DB = "deleted";

const META = [
  "deleted_at",
  "deleted_by_user_id",
  "deleted_by_user_name",
  "deleted_by_user_level",
] as const;

const SHEETS = {
  jobs: "DeletedJobs",
  steps: "DeletedSteps",
  events: "DeletedEvents",
  assignees: "DeletedAssignees",
  handovers: "DeletedHandovers",
  partLoans: "DeletedPartLoans",
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
  deleted_at: string,
  actor?: AuditActor | null
): Record<(typeof META)[number], string> {
  return {
    deleted_at,
    deleted_by_user_id: actor?.user_id || "",
    deleted_by_user_name: actor?.user_name || "",
    deleted_by_user_level: actor?.user_level || "",
  };
}


/** Append full job snapshot to data/deleted-jobs.xlsx before hard-delete. */
export async function archiveDeletedJob(input: {
  job: Job;
  steps: JobStep[];
  events: JobEvent[];
  assignees: JobAssignee[];
  handovers: JobHandover[];
  part_loans: JobPartLoan[];
  technicians: Technician[];
  actor?: AuditActor | null;
  deleted_at: string;
}): Promise<void> {
  const meta = metaFields(input.deleted_at, input.actor);
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
