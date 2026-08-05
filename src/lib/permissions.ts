import type { UserLevel } from "@/lib/types";

export type AccessLevel = UserLevel | "guest";
export type AccessResource =
  | "job"
  | "user"
  | "technician"
  | "unit"
  | "attendance";
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
  },
  superuser: {
    job: CRUD,
    user: CRUD,
    technician: CRUD,
    unit: CRUD,
    attendance: CRUD,
  },
  inputer: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
  },
  teknisi: {
    job: READ,
    user: READ,
    technician: READ,
    unit: NONE,
    attendance: READ,
  },
  foreman: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
  },
  hrd: {
    job: READ,
    user: READ,
    technician: READ,
    unit: READ,
    attendance: CRUD,
  },
  spv: {
    job: CRUD,
    user: READ,
    technician: READ,
    unit: CRUD,
    attendance: READ,
  },
};

export function canAccess(
  level: AccessLevel | undefined,
  resource: AccessResource,
  action: AccessAction
): boolean {
  return Boolean(level && ACCESS_MATRIX[level]?.[resource]?.includes(action));
}
