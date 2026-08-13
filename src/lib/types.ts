export type TechnicianStatus = "available" | "busy" | "offline";

export type JobStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "paused"
  | "done"
  | "cancelled";

export type StepStatus = "pending" | "in_progress" | "done";

export type JobEventType =
  | "created"
  | "assigned"
  | "started"
  | "paused"
  | "resumed"
  | "step_started"
  | "step_completed"
  | "completed"
  | "cancelled"
  | "reopened"
  | "updated"
  | "deleted";

/** Who performed a mutation (from NextAuth session). */
export interface AuditActor {
  user_id: string;
  user_name: string;
  user_level: string;
}

export interface Technician {
  id: string;
  name: string;
  /** Serial number / SN */
  sn: string;
  status: TechnicianStatus;
  current_job_id: string;
  phone: string;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  serial_number: string;
  active: string; // "1" | "0"
}

export type JobTemplateCategory = "engine" | "non_engine" | "goh";

/** Master catalog entry (from data/job-templates.json). */
export interface JobTemplateStep {
  id: string;
  template_id: string;
  phase: string;
  name: string;
  order: number;
  man_power: number;
  std_minutes: number;
}

export interface JobTemplate {
  id: string;
  category: JobTemplateCategory;
  name: string;
  active: string; // "1" | "0"
  std_minutes: number;
  steps: JobTemplateStep[];
}

export interface JobTemplateSummary {
  id: string;
  category: JobTemplateCategory;
  name: string;
  std_minutes: number;
  step_count: number;
}

export interface Job {
  id: string;
  title: string;
  unit: string;
  unit_id: string;
  description: string;
  status: JobStatus;
  /** Lead / primary technician (first assignee). Kept for Excel compatibility. */
  technician_id: string;
  /** Reference to JobTemplate.id — avoids duplicating time-frame master data. */
  template_id: string;
  created_at: string;
  started_at: string;
  completed_at: string;
  paused_at: string;
  total_paused_sec: number;
  estimated_minutes: number;
}

export interface JobAssignee {
  id: string;
  job_id: string;
  technician_id: string;
  assigned_at: string;
  is_lead: string; // "1" | "0" as Excel-friendly flag
}

export interface JobStep {
  id: string;
  job_id: string;
  name: string;
  order: number;
  status: StepStatus;
  started_at: string;
  completed_at: string;
  duration_sec: number;
  /** Standard time from template STP/Std Hours (minutes). */
  std_minutes: number;
}

export interface JobEvent {
  id: string;
  job_id: string;
  type: JobEventType;
  note: string;
  created_at: string;
  user_id: string;
  user_name: string;
  user_level: string;
}

/** Append-only audit trail (survives job delete). */
export interface AuditLogEntry {
  id: string;
  at: string;
  user_id: string;
  user_name: string;
  user_level: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
}

export interface JobHandover {
  id: string;
  job_id: string;
  order: number;
  title: string;
  /** "1" = Yes/done, "0" = No */
  done: string;
  note: string;
  user_id: string;
  user_name: string;
  updated_at: string;
}

/** Catatan peminjaman part pada job aktif. */
export type PartLoanStatus = "open" | "closed";

export interface JobPartLoan {
  id: string;
  job_id: string;
  order: number;
  /** Part yang dipinjam */
  part_name: string;
  status: PartLoanStatus;
  note: string;
  user_id: string;
  user_name: string;
  updated_at: string;
}

export interface JobWithDetails extends Job {
  technician?: Technician | null;
  technicians: Technician[];
  steps: JobStep[];
  events: JobEvent[];
  handovers: JobHandover[];
  part_loans: JobPartLoan[];
  elapsed_sec: number;
  progress_pct: number;
  /** First active step (compat). Prefer current_steps for parallel work. */
  current_step?: JobStep | null;
  /** All steps currently in_progress (may be multiple / parallel). */
  current_steps: JobStep[];
  /** Loaded from data/completed-jobs.xlsx (not in workshop). */
  from_archive?: boolean;
}

export type AttendanceStatus = "hadir" | "izin" | "sakit" | "off" | "alpha";

export interface Attendance {
  id: string;
  date: string; // YYYY-MM-DD
  technician_id: string;
  technician_name: string;
  pernr: string;
  status: AttendanceStatus;
  dws: string;
  check_in: string;
  check_out: string;
  absence: string;
  note: string;
}

/** App login account stored in Excel Users sheet. */
export const USER_LEVELS = [
  "superuser",
  "inputer",
  "teknisi",
  "foreman",
  "hrd",
  "spv",
] as const;

export type UserLevel = (typeof USER_LEVELS)[number];

export interface AppUser {
  id: string;
  username: string;
  password: string;
  name: string;
  level: UserLevel;
  active: string; // "1" | "0"
  created_at: string;
}

/** User payload without password (for API / UI). */
export type AppUserPublic = Omit<AppUser, "password">;

/** Row from backup-jobs.xlsx ChangeLog (superuser undo). */
export interface JobChangeBackup {
  id: string;
  at: string;
  user_name: string;
  user_level: string;
  action: string;
  entity: string;
  job_id: string;
  summary: string;
  undone: string;
}

export interface DashboardData {
  technicians: Technician[];
  units: Unit[];
  jobs: JobWithDetails[];
  /** Jobs archived after complete (from completed-jobs.xlsx). */
  completed_jobs: JobWithDetails[];
  /** Jobs archived after cancel (from cancelled-jobs.xlsx). */
  cancelled_jobs: JobWithDetails[];
  attendance: Attendance[];
  summary: {
    available: number;
    busy: number;
    offline: number;
    active_jobs: number;
    queued_jobs: number;
    done_today: number;
    completed_jobs: number;
    cancelled_jobs: number;
    avg_duration_sec: number;
  };
}
