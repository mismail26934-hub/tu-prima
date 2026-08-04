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
  | "updated";

export interface Technician {
  id: string;
  name: string;
  skill: string;
  status: TechnicianStatus;
  current_job_id: string;
  phone: string;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  active: string; // "1" | "0"
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
}

export interface JobEvent {
  id: string;
  job_id: string;
  type: JobEventType;
  note: string;
  created_at: string;
}

export interface JobWithDetails extends Job {
  technician?: Technician | null;
  technicians: Technician[];
  steps: JobStep[];
  events: JobEvent[];
  elapsed_sec: number;
  progress_pct: number;
  current_step?: JobStep | null;
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

export interface DashboardData {
  technicians: Technician[];
  units: Unit[];
  jobs: JobWithDetails[];
  attendance: Attendance[];
  summary: {
    available: number;
    busy: number;
    offline: number;
    active_jobs: number;
    queued_jobs: number;
    done_today: number;
    avg_duration_sec: number;
  };
}
