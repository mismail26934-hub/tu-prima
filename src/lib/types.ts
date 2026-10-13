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
  | "deleted"
  | "delegated"
  | "undelegated";

/** Who performed a mutation (from NextAuth session). */
export interface AuditActor {
  user_id: string;
  user_name: string;
  user_level: string;
}

export interface Technician {
  id: string;
  name: string;
  /** Pernr / SN (HR, absensi, SharePoint sync) */
  sn: string;
  /** No. ID Badge — terpisah dari Pernr */
  badge_id: string;
  email: string;
  status: TechnicianStatus;
  current_job_id: string;
  phone: string;
  /** Foreman user who is this technician's superior. */
  superior_user_id: string;
  superior_user_name: string;
  /** Linked login account (users.id). Empty until a login is provisioned. */
  user_id?: string;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  serial_number: string;
  active: string; // "1" | "0"
}

export type JobTemplateCategory = "engine" | "non_engine" | "goh";

/** Master catalog entry (MySQL job_templates / job_template_steps). */
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

/** Stored on jobs.priority as a short code (jobs keep the code if master is deactivated). */
export type JobPriority = string;

export interface JobPriorityRecord {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  active: "1" | "0";
}

export const DEFAULT_JOB_PRIORITIES: JobPriorityRecord[] = [
  { id: "JP-URGENT", code: "URGENT", name: "Urgent", sort_order: 10, active: "1" },
  { id: "JP-P1", code: "P1", name: "P1", sort_order: 20, active: "1" },
  { id: "JP-P2", code: "P2", name: "P2", sort_order: 30, active: "1" },
  { id: "JP-P3", code: "P3", name: "P3", sort_order: 40, active: "1" },
];

/** Default seed codes — dropdowns should use the DB catalog, not this list. */
export const JOB_PRIORITIES = DEFAULT_JOB_PRIORITIES.map((p) => p.code);

export function normalizeJobPriority(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 16);
}

export function jobPriorityPillClass(code: string): string {
  const k = code.toLowerCase();
  if (k === "urgent" || k === "p1" || k === "p2" || k === "p3") {
    return `job-priority-pill job-priority-pill--${k}`;
  }
  return "job-priority-pill job-priority-pill--custom";
}

export interface Job {
  id: string;
  title: string;
  /** Optional selected-item priority code from job_priorities. */
  priority?: string;
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
  /** Stored filename of the first job photo (empty = none). */
  photo_name?: string;
  /** Job-level photos (create/edit job). */
  photos?: Array<{
    id: string;
    name: string;
    url?: string;
    thumb_url?: string;
  }>;
  /** Foreman/superuser who last assigned technicians (operational owner). */
  assigned_by_user_id?: string;
  assigned_by_user_name?: string;
  assigned_by_user_level?: string;
  /** Optional co-manager foreman (shared access with assigner). */
  delegated_to_user_id?: string;
  delegated_to_user_name?: string;
  delegated_at?: string;
  delegated_by_user_id?: string;
}

export interface JobAssignee {
  id: string;
  job_id: string;
  technician_id: string;
  assigned_at: string;
  is_lead: string; // "1" | "0" as Excel-friendly flag
}

export interface JobStepNote {
  id: string;
  body: string;
  user_id: string;
  user_name: string;
  created_at: string;
  /** Set when a controlling foreman edits an existing entry. */
  edited_at?: string;
  edited_by_user_id?: string;
  edited_by_name?: string;
  /** Stored PDF filename in data/step-note-files (empty = none). */
  file_id?: string;
  file_name?: string;
  file_original_name?: string;
  file_url?: string;
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
  /** Template STP/Std Hours in minutes. Display/timer divide this by step technicians. */
  std_minutes: number;
  /**
   * Technicians who worked this step (subset of job assignees).
   * Empty / omitted = all technicians assigned to the job.
   */
  technician_ids?: string[];
  /** Free-text catatan per step (isi entri terakhir, untuk kompatibilitas). */
  note?: string;
  /** Thread catatan step (tambah = append; ubah isi lama = pengendali job). */
  notes?: JobStepNote[];
  /** Stored filename in data/step-photos (empty = no evidence yet). */
  photo_name?: string;
  /** Public GET URL of the first photo when present. */
  photo_url?: string;
  /** Evidence photos for this step (one or more). */
  photos?: Array<{
    id: string;
    name: string;
    url?: string;
    thumb_url?: string;
  }>;
  note_updated_by_user_id?: string;
  note_updated_by_name?: string;
  note_updated_at?: string;
  photo_updated_by_user_id?: string;
  photo_updated_by_name?: string;
  photo_updated_at?: string;
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
  /** Foreman the handover is from. */
  from_name: string;
  from_user_id: string;
  /** Free-text recipient (who the handover is directed to). */
  to_name: string;
  /** Foreman user id for WhatsApp DM (stable even if the display name changes). */
  to_user_id: string;
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
  /**
   * Name lookup for step history — includes technicians who worked a step
   * even if they were later unassigned from the job.
   */
  technician_index?: Technician[];
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
  email: string;
  phone: string;
  photo_name: string;
  level: UserLevel;
  active: string; // "1" | "0"
  created_at: string;
}

/** User payload without password (for API / UI). */
export type AppUserPublic = Omit<AppUser, "password"> & {
  photo_url?: string;
  /** Set when this user is the auto-created login for a master technician. */
  technician_id?: string;
};

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
  before_json?: string;
  after_json?: string;
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
