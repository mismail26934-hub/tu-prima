import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { calcElapsedSec, calcProgressPct } from "@/lib/duration";
import type {
  DashboardData,
  Job,
  JobAssignee,
  JobEvent,
  JobEventType,
  JobHandover,
  JobPartLoan,
  JobStatus,
  JobStep,
  JobWithDetails,
  PartLoanStatus,
  StepStatus,
  Technician,
  TechnicianStatus,
} from "@/lib/types";

export type JobListSection = "active" | "queue" | "done" | "cancelled";
export type JobOwnershipFilter = "all" | "mine" | "delegated";

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TechnicianListItem extends Technician {
  current_job_title?: string;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapTechnicianRow(r: mysql.RowDataPacket): Technician {
  return {
    id: str(r.id),
    name: str(r.name),
    sn: str(r.sn),
    status: str(r.status || "available") as TechnicianStatus,
    current_job_id: str(r.current_job_id),
    phone: str(r.phone),
  };
}

function mapJobRow(r: mysql.RowDataPacket): Job {
  return {
    id: str(r.id),
    title: str(r.title),
    unit: str(r.unit_label),
    unit_id: str(r.unit_id),
    description: str(r.description),
    status: str(r.status || "queued") as JobStatus,
    technician_id: str(r.technician_id),
    template_id: str(r.template_id),
    created_at: str(r.created_at),
    started_at: str(r.started_at),
    completed_at: str(r.completed_at),
    paused_at: str(r.paused_at),
    total_paused_sec: num(r.total_paused_sec),
    estimated_minutes: num(r.estimated_minutes),
    assigned_by_user_id: str(r.assigned_by_user_id),
    assigned_by_user_name: str(r.assigned_by_user_name),
    assigned_by_user_level: str(r.assigned_by_user_level),
    delegated_to_user_id: str(r.delegated_to_user_id),
    delegated_to_user_name: str(r.delegated_to_user_name),
    delegated_at: str(r.delegated_at),
    delegated_by_user_id: str(r.delegated_by_user_id),
  };
}

function mapStepRow(r: mysql.RowDataPacket): JobStep {
  return {
    id: str(r.id),
    job_id: str(r.job_id),
    name: str(r.name),
    order: num(r.step_order),
    status: str(r.status || "pending") as StepStatus,
    started_at: str(r.started_at),
    completed_at: str(r.completed_at),
    duration_sec: num(r.duration_sec),
    std_minutes: num(r.std_minutes),
  };
}

function mapEventRow(r: mysql.RowDataPacket): JobEvent {
  return {
    id: str(r.id),
    job_id: str(r.job_id),
    type: str(r.type || "created") as JobEventType,
    note: str(r.note),
    created_at: str(r.created_at),
    user_id: str(r.user_id),
    user_name: str(r.user_name),
    user_level: str(r.user_level),
  };
}

function mapAssigneeRow(r: mysql.RowDataPacket): JobAssignee {
  return {
    id: str(r.id),
    job_id: str(r.job_id),
    technician_id: str(r.technician_id),
    assigned_at: str(r.assigned_at),
    is_lead: num(r.is_lead) ? "1" : "0",
  };
}

function mapHandoverRow(r: mysql.RowDataPacket): JobHandover {
  return {
    id: str(r.id),
    job_id: str(r.job_id),
    order: num(r.handover_order),
    title: str(r.title),
    done: num(r.done) ? "1" : "0",
    note: str(r.note),
    user_id: str(r.user_id),
    user_name: str(r.user_name),
    updated_at: str(r.updated_at),
  };
}

function mapPartLoanRow(r: mysql.RowDataPacket): JobPartLoan {
  const raw = str(r.status || "open").toLowerCase();
  const status: PartLoanStatus = raw === "closed" ? "closed" : "open";
  return {
    id: str(r.id),
    job_id: str(r.job_id),
    order: num(r.loan_order),
    part_name: str(r.part_name),
    status,
    note: str(r.note),
    user_id: str(r.user_id),
    user_name: str(r.user_name),
    updated_at: str(r.updated_at),
  };
}

function sectionScope(section: JobListSection): {
  jobScope: "active" | "completed" | "cancelled";
  statuses: string[] | null;
  fromArchive: boolean;
} {
  switch (section) {
    case "active":
      return {
        jobScope: "active",
        statuses: ["in_progress", "paused", "assigned"],
        fromArchive: false,
      };
    case "queue":
      return {
        jobScope: "active",
        statuses: ["queued"],
        fromArchive: false,
      };
    case "done":
      return { jobScope: "completed", statuses: null, fromArchive: true };
    case "cancelled":
      return { jobScope: "cancelled", statuses: null, fromArchive: true };
  }
}

function buildJobWhere(
  section: JobListSection,
  q: string,
  ownership: JobOwnershipFilter,
  userId: string
): { sql: string; params: unknown[] } {
  const { jobScope, statuses } = sectionScope(section);
  const parts = ["job_scope = ?"];
  const params: unknown[] = [jobScope];

  if (statuses?.length) {
    parts.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }

  const term = q.trim().toLowerCase();
  if (term) {
    parts.push(
      "(LOWER(title) LIKE ? OR LOWER(unit_label) LIKE ? OR LOWER(description) LIKE ? OR LOWER(status) LIKE ?)"
    );
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }

  if (ownership === "mine" && userId) {
    parts.push("assigned_by_user_id = ?");
    params.push(userId);
  } else if (ownership === "delegated" && userId) {
    parts.push("delegated_to_user_id = ?");
    params.push(userId);
  }

  return { sql: parts.join(" AND "), params };
}

async function loadAllTechnicians(): Promise<Technician[]> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, name, sn, status, current_job_id, phone FROM technicians ORDER BY name`
  );
  return rows.map(mapTechnicianRow);
}

async function enrichJobsBatch(
  jobs: Job[],
  fromArchive: boolean
): Promise<JobWithDetails[]> {
  if (!jobs.length) return [];

  const jobIds = jobs.map((j) => j.id).filter(Boolean);
  const ph = jobIds.map(() => "?").join(",");
  const p = getPool();

  const [steps] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_steps WHERE job_id IN (${ph}) ORDER BY job_id, step_order`,
    jobIds
  );
  const [events] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_events WHERE job_id IN (${ph}) ORDER BY job_id, created_at`,
    jobIds
  );
  const [assignees] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_assignees WHERE job_id IN (${ph}) ORDER BY job_id, assigned_at`,
    jobIds
  );
  const [handovers] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_handovers WHERE job_id IN (${ph}) ORDER BY job_id, handover_order`,
    jobIds
  );
  const [partLoans] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_part_loans WHERE job_id IN (${ph}) ORDER BY job_id, loan_order`,
    jobIds
  );

  const techs = await loadAllTechnicians();
  const techById = new Map(techs.map((t) => [t.id, t]));

  const stepsByJob = new Map<string, JobStep[]>();
  for (const row of steps) {
    const step = mapStepRow(row);
    const list = stepsByJob.get(step.job_id) || [];
    list.push(step);
    stepsByJob.set(step.job_id, list);
  }

  const eventsByJob = new Map<string, JobEvent[]>();
  for (const row of events) {
    const ev = mapEventRow(row);
    const list = eventsByJob.get(ev.job_id) || [];
    list.push(ev);
    eventsByJob.set(ev.job_id, list);
  }

  const assigneesByJob = new Map<string, JobAssignee[]>();
  for (const row of assignees) {
    const a = mapAssigneeRow(row);
    const list = assigneesByJob.get(a.job_id) || [];
    list.push(a);
    assigneesByJob.set(a.job_id, list);
  }

  const handoversByJob = new Map<string, JobHandover[]>();
  for (const row of handovers) {
    const h = mapHandoverRow(row);
    const list = handoversByJob.get(h.job_id) || [];
    list.push(h);
    handoversByJob.set(h.job_id, list);
  }

  const partLoansByJob = new Map<string, JobPartLoan[]>();
  for (const row of partLoans) {
    const pl = mapPartLoanRow(row);
    const list = partLoansByJob.get(pl.job_id) || [];
    list.push(pl);
    partLoansByJob.set(pl.job_id, list);
  }

  return jobs.map((job) => {
    let jobAssignees = assigneesByJob.get(job.id) || [];
    if (jobAssignees.length === 0 && job.technician_id) {
      jobAssignees = [
        {
          id: "",
          job_id: job.id,
          technician_id: job.technician_id,
          assigned_at: job.created_at,
          is_lead: "1",
        },
      ];
    }
    const technicians = jobAssignees
      .map((a) => techById.get(a.technician_id))
      .filter((t): t is Technician => Boolean(t));
    const technician =
      technicians.find((t) => t.id === job.technician_id) ||
      technicians[0] ||
      null;
    const jobSteps = (stepsByJob.get(job.id) || []).slice().sort((a, b) => a.order - b.order);
    const current_steps = jobSteps.filter((s) => s.status === "in_progress");
    return {
      ...job,
      technician,
      technicians,
      steps: jobSteps,
      events: eventsByJob.get(job.id) || [],
      handovers: handoversByJob.get(job.id) || [],
      part_loans: partLoansByJob.get(job.id) || [],
      elapsed_sec: calcElapsedSec(job),
      progress_pct: calcProgressPct(jobSteps),
      current_step: current_steps[0] || null,
      current_steps,
      from_archive: fromArchive,
    };
  });
}

export async function listJobsPaginated(input: {
  section: JobListSection;
  page: number;
  limit: number;
  q?: string;
  ownership?: JobOwnershipFilter;
  userId?: string;
}): Promise<PaginatedResult<JobWithDetails>> {
  const page = Math.max(1, Math.floor(input.page || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit || 10)));
  const offset = (page - 1) * limit;
  const q = input.q || "";
  const ownership = input.ownership || "all";
  const userId = input.userId || "";
  const { fromArchive } = sectionScope(input.section);
  const { sql, params } = buildJobWhere(input.section, q, ownership, userId);
  const p = getPool();

  const [countRows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE ${sql}`,
    params
  );
  const total = num(countRows[0]?.cnt);

  const [jobRows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM jobs WHERE ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const jobs = jobRows.map(mapJobRow);
  const items = await enrichJobsBatch(jobs, fromArchive);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return { items, total, page, limit, totalPages };
}

export async function listTechniciansPaginated(input: {
  status?: "all" | TechnicianStatus;
  page: number;
  limit: number;
  q?: string;
}): Promise<PaginatedResult<TechnicianListItem>> {
  const page = Math.max(1, Math.floor(input.page || 1));
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit || 10)));
  const offset = (page - 1) * limit;
  const q = (input.q || "").trim().toLowerCase();
  const status = input.status || "all";

  const parts: string[] = [];
  const params: unknown[] = [];

  if (status !== "all") {
    parts.push("t.status = ?");
    params.push(status);
  }
  if (q) {
    parts.push("(LOWER(t.name) LIKE ? OR LOWER(t.sn) LIKE ? OR LOWER(t.phone) LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  const p = getPool();

  const [countRows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM technicians t ${where}`,
    params
  );
  const total = num(countRows[0]?.cnt);

  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT t.id, t.name, t.sn, t.status, t.current_job_id, t.phone, j.title AS current_job_title
     FROM technicians t
     LEFT JOIN jobs j ON j.id = t.current_job_id AND j.job_scope = 'active'
     ${where}
     ORDER BY t.name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const items: TechnicianListItem[] = rows.map((r) => ({
    ...mapTechnicianRow(r),
    current_job_title: str(r.current_job_title) || undefined,
  }));
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return { items, total, page, limit, totalPages };
}

export async function fetchDashboardSummary(): Promise<DashboardData["summary"]> {
  const p = getPool();
  const today = new Date().toISOString().slice(0, 10);

  const [[techRows], [activeRow], [queueRow], [completedRow], [cancelledRow], [doneTodayRows]] =
    await Promise.all([
      p.query<mysql.RowDataPacket[]>(
        `SELECT status, COUNT(*) AS cnt FROM technicians GROUP BY status`
      ),
      p.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM jobs WHERE job_scope = 'active' AND status IN ('in_progress','paused','assigned')`
      ),
      p.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM jobs WHERE job_scope = 'active' AND status = 'queued'`
      ),
      p.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM jobs WHERE job_scope = 'completed'`
      ),
      p.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM jobs WHERE job_scope = 'cancelled'`
      ),
      p.query<mysql.RowDataPacket[]>(
        `SELECT total_paused_sec, started_at, completed_at, paused_at, status
         FROM jobs
         WHERE job_scope = 'completed' AND completed_at LIKE ?`,
        [`${today}%`]
      ),
    ]);

  let available = 0;
  let busy = 0;
  let offline = 0;
  for (const row of techRows) {
    const st = str(row.status);
    const cnt = num(row.cnt);
    if (st === "available") available = cnt;
    else if (st === "busy") busy = cnt;
    else if (st === "offline") offline = cnt;
  }

  const doneTodayJobs = doneTodayRows.map(mapJobRow);
  const avg =
    doneTodayJobs.length === 0
      ? 0
      : Math.round(
          doneTodayJobs.reduce((sum, j) => sum + calcElapsedSec(j), 0) /
            doneTodayJobs.length
        );

  return {
    available,
    busy,
    offline,
    active_jobs: num(activeRow[0]?.cnt),
    queued_jobs: num(queueRow[0]?.cnt),
    done_today: doneTodayJobs.length,
    completed_jobs: num(completedRow[0]?.cnt),
    cancelled_jobs: num(cancelledRow[0]?.cnt),
    avg_duration_sec: avg,
  };
}
