import type { Job, UserLevel } from "@/lib/types";

export type AccessLevel = UserLevel | "guest";
export type AccessResource =
  | "job"
  | "user"
  | "technician"
  | "unit"
  | "attendance"
  | "template";
export type AccessAction = "create" | "read" | "update" | "delete";

const CRUD: AccessAction[] = ["create", "read", "update", "delete"];
const READ: AccessAction[] = ["read"];
const NONE: AccessAction[] = [];

export const ACCESS_MATRIX: Record<
  AccessLevel,
  Record<AccessResource, readonly AccessAction[]>
> = {
  guest: {
    job: READ,
    user: READ,
    technician: READ,
    unit: NONE,
    attendance: READ,
    template: NONE,
  },
  superuser: {
    job: CRUD,
    user: CRUD,
    technician: CRUD,
    unit: CRUD,
    attendance: CRUD,
    template: CRUD,
  },
  inputer: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
    template: CRUD,
  },
  teknisi: {
    job: READ,
    user: READ,
    technician: READ,
    unit: NONE,
    attendance: READ,
    template: READ,
  },
  foreman: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
    template: CRUD,
  },
  hrd: {
    job: READ,
    user: READ,
    technician: READ,
    unit: READ,
    attendance: CRUD,
    template: READ,
  },
  spv: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
    template: CRUD,
  },
};

export const JOB_MANAGE_DENIED_MSG =
  "Hanya penugas, foreman yang didelegasikan, atau superuser yang boleh mengubah job ini";

const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "assigned",
  "in_progress",
  "paused",
]);

const QUEUED_UNASSIGNED_MANAGE_LEVELS = new Set<AccessLevel>([
  "superuser",
  "foreman",
  "inputer",
  "spv",
]);

export function canAccess(
  level: AccessLevel | undefined,
  resource: AccessResource,
  action: AccessAction
): boolean {
  return Boolean(level && ACCESS_MATRIX[level]?.[resource]?.includes(action));
}

/** Assign teknisi ke job: hanya superuser & foreman. */
export function canAssignJob(level: AccessLevel | undefined): boolean {
  return level === "superuser" || level === "foreman";
}

/** Start/pause/resume, selesaikan step, dan complete job: hanya superuser & foreman. */
export function canManageJobProgress(level: AccessLevel | undefined): boolean {
  return level === "superuser" || level === "foreman";
}

/** Add/update/delete catatan handover: hanya foreman. */
export function canManageHandover(level: AccessLevel | undefined): boolean {
  return level === "foreman";
}

/** Buka kembali job done → paused: hanya superuser. */
export function canReopenJob(level: AccessLevel | undefined): boolean {
  return level === "superuser";
}

/** Set teknisi available/offline dari board (superuser & foreman). */
export function canSetTechnicianPresence(
  level: AccessLevel | undefined
): boolean {
  return level === "superuser" || level === "foreman";
}

export function jobHasTechnicianAssignment(
  job: Pick<Job, "technician_id" | "status">,
  assigneeCount = 0
): boolean {
  return Boolean(job.technician_id) || assigneeCount > 0;
}

/** Manage active/queued job: owner, delegatee, or queued-unassigned roles. Superuser bypass. */
export function canManageActiveJob(
  level: AccessLevel | undefined,
  userId: string | undefined,
  job: Pick<
    Job,
    | "status"
    | "technician_id"
    | "assigned_by_user_id"
    | "delegated_to_user_id"
  >,
  assigneeCount = 0
): boolean {
  if (!level || level === "guest") return false;
  if (level === "superuser") return true;
  if (!ACTIVE_JOB_STATUSES.has(job.status)) return false;

  const hasAssignment = jobHasTechnicianAssignment(job, assigneeCount);
  if (job.status === "queued" && !hasAssignment) {
    return QUEUED_UNASSIGNED_MANAGE_LEVELS.has(level);
  }

  if (!userId) return false;
  return (
    userId === (job.assigned_by_user_id || "") ||
    userId === (job.delegated_to_user_id || "")
  );
}

/** Assign / re-assign teknisi (role foreman + ownership rules). */
export function canAssignTechnicians(
  level: AccessLevel | undefined,
  userId: string | undefined,
  job: Pick<
    Job,
    | "status"
    | "technician_id"
    | "assigned_by_user_id"
    | "delegated_to_user_id"
  >,
  assigneeCount = 0
): boolean {
  if (!canAssignJob(level)) return false;
  if (level === "superuser") return true;
  if (job.status === "queued" && !jobHasTechnicianAssignment(job, assigneeCount)) {
    return level === "foreman";
  }
  return canManageActiveJob(level, userId, job, assigneeCount);
}

/** Progress actions: foreman/superuser role + ownership. */
export function canOperateJobProgress(
  level: AccessLevel | undefined,
  userId: string | undefined,
  job: Pick<
    Job,
    | "status"
    | "technician_id"
    | "assigned_by_user_id"
    | "delegated_to_user_id"
  >,
  assigneeCount = 0
): boolean {
  if (!canManageJobProgress(level)) return false;
  return canManageActiveJob(level, userId, job, assigneeCount);
}

/** Delegasi job ke foreman lain (penugas asli atau superuser). */
export function canDelegateJob(
  level: AccessLevel | undefined,
  userId: string | undefined,
  job: Pick<Job, "assigned_by_user_id">
): boolean {
  if (!level || !userId) return false;
  if (level === "superuser") return true;
  if (level !== "foreman") return false;
  if (!job.assigned_by_user_id) return false;
  return userId === job.assigned_by_user_id;
}
