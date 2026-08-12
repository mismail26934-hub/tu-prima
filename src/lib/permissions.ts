import type { UserLevel } from "@/lib/types";

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
