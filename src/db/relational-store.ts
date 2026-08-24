/**
 * Relational persistence for TU-PRIMA (MariaDB tables).
 * Loads/saves MysqlWorkbook sheets ↔ normalized MariaDB tables.
 */
import type mysql from "mysql2/promise";
import { getPool, type DbRow, MysqlWorkbook, MysqlSheet } from "./mysql-workbook";

export type JobScope = "active" | "completed" | "cancelled" | "deleted";

const WORKBOOK_SCOPE: Record<string, JobScope | "backup"> = {
  workshop: "active",
  completed: "completed",
  cancelled: "cancelled",
  deleted: "deleted",
  backup: "backup",
};

const SCOPE_JOB_SHEET: Record<JobScope, string> = {
  active: "Jobs",
  completed: "CompletedJobs",
  cancelled: "CancelledJobs",
  deleted: "DeletedJobs",
};

const SCOPE_STEP_SHEET: Record<JobScope, string> = {
  active: "JobSteps",
  completed: "CompletedSteps",
  cancelled: "CancelledSteps",
  deleted: "DeletedSteps",
};

const SCOPE_EVENT_SHEET: Record<JobScope, string> = {
  active: "JobEvents",
  completed: "CompletedEvents",
  cancelled: "CancelledEvents",
  deleted: "DeletedEvents",
};

const SCOPE_ASSIGNEE_SHEET: Record<JobScope, string> = {
  active: "JobAssignees",
  completed: "CompletedAssignees",
  cancelled: "CancelledAssignees",
  deleted: "DeletedAssignees",
};

const SCOPE_HANDOVER_SHEET: Record<JobScope, string> = {
  active: "JobHandovers",
  completed: "CompletedHandovers",
  cancelled: "CancelledHandovers",
  deleted: "DeletedHandovers",
};

const SCOPE_PART_LOAN_SHEET: Record<JobScope, string> = {
  active: "JobPartLoans",
  completed: "CompletedPartLoans",
  cancelled: "CancelledPartLoans",
  deleted: "DeletedPartLoans",
};

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function flag01(v: unknown): number {
  return str(v) === "0" ? 0 : str(v) === "1" || v === 1 || v === true ? 1 : 0;
}

function jobRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  const base: DbRow = {
    id: str(r.id),
    title: str(r.title),
    unit: str(r.unit_label),
    unit_id: str(r.unit_id),
    description: str(r.description),
    status: str(r.status),
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
  if (scope === "deleted") {
    return {
      deleted_at: str(r.deleted_at),
      deleted_by_user_id: str(r.deleted_by_user_id),
      deleted_by_user_name: str(r.deleted_by_user_name),
      deleted_by_user_level: str(r.deleted_by_user_level),
      ...base,
    };
  }
  if (scope === "completed" || scope === "cancelled") {
    return {
      archived_at: str(r.archived_at),
      archived_by_user_id: str(r.archived_by_user_id),
      archived_by_user_name: str(r.archived_by_user_name),
      archived_by_user_level: str(r.archived_by_user_level),
      ...base,
    };
  }
  return base;
}

function jobRowToDb(row: DbRow, scope: JobScope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: str(row.id),
    job_scope: scope,
    title: str(row.title),
    unit_label: str(row.unit),
    unit_id: str(row.unit_id),
    description: str(row.description),
    status: str(row.status),
    technician_id: str(row.technician_id),
    template_id: str(row.template_id),
    created_at: str(row.created_at),
    started_at: str(row.started_at),
    completed_at: str(row.completed_at),
    paused_at: str(row.paused_at),
    total_paused_sec: num(row.total_paused_sec),
    estimated_minutes: num(row.estimated_minutes),
    assigned_by_user_id: str(row.assigned_by_user_id),
    assigned_by_user_name: str(row.assigned_by_user_name),
    assigned_by_user_level: str(row.assigned_by_user_level),
    delegated_to_user_id: str(row.delegated_to_user_id),
    delegated_to_user_name: str(row.delegated_to_user_name),
    delegated_at: str(row.delegated_at),
    delegated_by_user_id: str(row.delegated_by_user_id),
    archived_at: "",
    archived_by_user_id: "",
    archived_by_user_name: "",
    archived_by_user_level: "",
    deleted_at: "",
    deleted_by_user_id: "",
    deleted_by_user_name: "",
    deleted_by_user_level: "",
  };
  if (scope === "deleted") {
    out.deleted_at = str(row.deleted_at);
    out.deleted_by_user_id = str(row.deleted_by_user_id);
    out.deleted_by_user_name = str(row.deleted_by_user_name);
    out.deleted_by_user_level = str(row.deleted_by_user_level);
  } else if (scope === "completed" || scope === "cancelled") {
    out.archived_at = str(row.archived_at);
    out.archived_by_user_id = str(row.archived_by_user_id);
    out.archived_by_user_name = str(row.archived_by_user_name);
    out.archived_by_user_level = str(row.archived_by_user_level);
  }
  return out;
}

function setSheet(wb: MysqlWorkbook, name: string, headers: string[], rows: DbRow[]) {
  wb.setSheetData(name, headers, rows);
}

async function loadScopedJobs(
  conn: mysql.Pool | mysql.PoolConnection,
  wb: MysqlWorkbook,
  scope: JobScope
) {
  const [jobs] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM jobs WHERE job_scope = ? ORDER BY created_at`,
    [scope]
  );
  const jobIds = jobs.map((j) => str(j.id)).filter(Boolean);
  if (!jobIds.length) {
    setSheet(wb, SCOPE_JOB_SHEET[scope], jobHeaders(scope), []);
    setSheet(wb, SCOPE_STEP_SHEET[scope], stepHeaders(scope), []);
    setSheet(wb, SCOPE_EVENT_SHEET[scope], eventHeaders(scope), []);
    setSheet(wb, SCOPE_ASSIGNEE_SHEET[scope], assigneeHeaders(scope), []);
    setSheet(wb, SCOPE_HANDOVER_SHEET[scope], handoverHeaders(scope), []);
    setSheet(wb, SCOPE_PART_LOAN_SHEET[scope], partLoanHeaders(scope), []);
    return;
  }

  const ph = jobIds.map(() => "?").join(",");
  const [steps] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_steps WHERE job_id IN (${ph}) ORDER BY job_id, step_order`,
    jobIds
  );
  const [events] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_events WHERE job_id IN (${ph}) ORDER BY job_id, created_at`,
    jobIds
  );
  const [assignees] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_assignees WHERE job_id IN (${ph}) ORDER BY job_id, assigned_at`,
    jobIds
  );
  const [handovers] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_handovers WHERE job_id IN (${ph}) ORDER BY job_id, handover_order`,
    jobIds
  );
  const [partLoans] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT * FROM job_part_loans WHERE job_id IN (${ph}) ORDER BY job_id, loan_order`,
    jobIds
  );

  setSheet(
    wb,
    SCOPE_JOB_SHEET[scope],
    jobHeaders(scope),
    jobs.map((r) => jobRowFromDb(r, scope))
  );
  setSheet(
    wb,
    SCOPE_STEP_SHEET[scope],
    stepHeaders(scope),
    steps.map((r) => stepRowFromDb(r, scope))
  );
  setSheet(
    wb,
    SCOPE_EVENT_SHEET[scope],
    eventHeaders(scope),
    events.map((r) => eventRowFromDb(r, scope))
  );
  setSheet(
    wb,
    SCOPE_ASSIGNEE_SHEET[scope],
    assigneeHeaders(scope),
    assignees.map((r) => assigneeRowFromDb(r, scope))
  );
  setSheet(
    wb,
    SCOPE_HANDOVER_SHEET[scope],
    handoverHeaders(scope),
    handovers.map((r) => handoverRowFromDb(r, scope))
  );
  setSheet(
    wb,
    SCOPE_PART_LOAN_SHEET[scope],
    partLoanHeaders(scope),
    partLoans.map((r) => partLoanRowFromDb(r, scope))
  );
}

function metaPrefix(scope: JobScope): string[] {
  if (scope === "deleted") {
    return [
      "deleted_at",
      "deleted_by_user_id",
      "deleted_by_user_name",
      "deleted_by_user_level",
    ];
  }
  if (scope === "completed" || scope === "cancelled") {
    return [
      "archived_at",
      "archived_by_user_id",
      "archived_by_user_name",
      "archived_by_user_level",
    ];
  }
  return [];
}

function jobHeaders(scope: JobScope): string[] {
  return [
    ...metaPrefix(scope),
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
    "assigned_by_user_id",
    "assigned_by_user_name",
    "assigned_by_user_level",
    "delegated_to_user_id",
    "delegated_to_user_name",
    "delegated_at",
    "delegated_by_user_id",
  ];
}

function stepHeaders(scope: JobScope): string[] {
  return [
    ...metaPrefix(scope),
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
}

function eventHeaders(scope: JobScope): string[] {
  return [
    ...metaPrefix(scope),
    "id",
    "job_id",
    "type",
    "note",
    "created_at",
    "user_id",
    "user_name",
    "user_level",
  ];
}

function assigneeHeaders(scope: JobScope): string[] {
  const base = ["id", "job_id", "technician_id", "assigned_at", "is_lead"];
  if (scope === "active") return base;
  return [
    ...metaPrefix(scope),
    ...base.slice(0, 3),
    "technician_name",
    "technician_sn",
    ...base.slice(3),
  ];
}

function handoverHeaders(scope: JobScope): string[] {
  return [
    ...metaPrefix(scope),
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
}

function partLoanHeaders(scope: JobScope): string[] {
  return [
    ...metaPrefix(scope),
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
}

function withMeta(row: DbRow, scope: JobScope): DbRow {
  if (scope === "active") return row;
  const meta = metaPrefix(scope);
  const out: DbRow = {};
  for (const k of meta) out[k] = str(row[k]);
  return { ...out, ...row };
}

function stepRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  return withMeta(
    {
      id: str(r.id),
      job_id: str(r.job_id),
      name: str(r.name),
      order: num(r.step_order),
      status: str(r.status),
      started_at: str(r.started_at),
      completed_at: str(r.completed_at),
      duration_sec: num(r.duration_sec),
      std_minutes: num(r.std_minutes),
    },
    scope
  );
}

function eventRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  return withMeta(
    {
      id: str(r.id),
      job_id: str(r.job_id),
      type: str(r.type),
      note: str(r.note),
      created_at: str(r.created_at),
      user_id: str(r.user_id),
      user_name: str(r.user_name),
      user_level: str(r.user_level),
    },
    scope
  );
}

function assigneeRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  const base: DbRow = {
    id: str(r.id),
    job_id: str(r.job_id),
    technician_id: str(r.technician_id),
    assigned_at: str(r.assigned_at),
    is_lead: flag01(r.is_lead) ? "1" : "0",
  };
  if (scope !== "active") {
    return withMeta(
      {
        ...base,
        technician_name: str(r.technician_name),
        technician_sn: str(r.technician_sn),
      },
      scope
    );
  }
  return base;
}

function handoverRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  return withMeta(
    {
      id: str(r.id),
      job_id: str(r.job_id),
      order: num(r.handover_order),
      title: str(r.title),
      done: flag01(r.done) ? "1" : "0",
      note: str(r.note),
      user_id: str(r.user_id),
      user_name: str(r.user_name),
      updated_at: str(r.updated_at),
    },
    scope
  );
}

function partLoanRowFromDb(r: mysql.RowDataPacket, scope: JobScope): DbRow {
  return withMeta(
    {
      id: str(r.id),
      job_id: str(r.job_id),
      order: num(r.loan_order),
      part_name: str(r.part_name),
      status: str(r.status) || "open",
      note: str(r.note),
      user_id: str(r.user_id),
      user_name: str(r.user_name),
      updated_at: str(r.updated_at),
    },
    scope
  );
}

async function saveScopedJobs(
  conn: mysql.PoolConnection,
  wb: MysqlWorkbook,
  scope: JobScope
) {
  const wsJob = wb.getWorksheet(SCOPE_JOB_SHEET[scope]);
  const jobRows = wsJob?.rows ?? [];

  const [existing] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM jobs WHERE job_scope = ?`,
    [scope]
  );
  const oldIds = existing.map((r) => str(r.id)).filter(Boolean);
  if (oldIds.length) {
    const ph = oldIds.map(() => "?").join(",");
    await conn.query(`DELETE FROM job_steps WHERE job_id IN (${ph})`, oldIds);
    await conn.query(`DELETE FROM job_events WHERE job_id IN (${ph})`, oldIds);
    await conn.query(`DELETE FROM job_assignees WHERE job_id IN (${ph})`, oldIds);
    await conn.query(`DELETE FROM job_handovers WHERE job_id IN (${ph})`, oldIds);
    await conn.query(`DELETE FROM job_part_loans WHERE job_id IN (${ph})`, oldIds);
  }
  await conn.query(`DELETE FROM jobs WHERE job_scope = ?`, [scope]);

  for (const row of jobRows) {
    const d = jobRowToDb(row, scope);
    await conn.query(
      `INSERT INTO jobs (
        id, job_scope, title, unit_label, unit_id, description, status,
        technician_id, template_id, created_at, started_at, completed_at,
        paused_at, total_paused_sec, estimated_minutes,
        archived_at, archived_by_user_id, archived_by_user_name, archived_by_user_level,
        deleted_at, deleted_by_user_id, deleted_by_user_name, deleted_by_user_level,
        assigned_by_user_id, assigned_by_user_name, assigned_by_user_level,
        delegated_to_user_id, delegated_to_user_name, delegated_at, delegated_by_user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.id,
        d.job_scope,
        d.title,
        d.unit_label,
        d.unit_id,
        d.description,
        d.status,
        d.technician_id,
        d.template_id,
        d.created_at,
        d.started_at,
        d.completed_at,
        d.paused_at,
        d.total_paused_sec,
        d.estimated_minutes,
        d.archived_at,
        d.archived_by_user_id,
        d.archived_by_user_name,
        d.archived_by_user_level,
        d.deleted_at,
        d.deleted_by_user_id,
        d.deleted_by_user_name,
        d.deleted_by_user_level,
        d.assigned_by_user_id,
        d.assigned_by_user_name,
        d.assigned_by_user_level,
        d.delegated_to_user_id,
        d.delegated_to_user_name,
        d.delegated_at,
        d.delegated_by_user_id,
      ]
    );
  }

  const insertSteps = wb.getWorksheet(SCOPE_STEP_SHEET[scope])?.rows ?? [];
  for (const row of insertSteps) {
    await conn.query(
      `INSERT INTO job_steps (id, job_id, name, step_order, status, started_at, completed_at, duration_sec, std_minutes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        str(row.id),
        str(row.job_id),
        str(row.name),
        num(row.order),
        str(row.status),
        str(row.started_at),
        str(row.completed_at),
        num(row.duration_sec),
        num(row.std_minutes),
      ]
    );
  }

  const insertEvents = wb.getWorksheet(SCOPE_EVENT_SHEET[scope])?.rows ?? [];
  for (const row of insertEvents) {
    await conn.query(
      `INSERT INTO job_events (id, job_id, type, note, created_at, user_id, user_name, user_level)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        str(row.id),
        str(row.job_id),
        str(row.type),
        str(row.note),
        str(row.created_at),
        str(row.user_id),
        str(row.user_name),
        str(row.user_level),
      ]
    );
  }

  const insertAssignees = wb.getWorksheet(SCOPE_ASSIGNEE_SHEET[scope])?.rows ?? [];
  for (const row of insertAssignees) {
    await conn.query(
      `INSERT INTO job_assignees (id, job_id, technician_id, technician_name, technician_sn, assigned_at, is_lead)
       VALUES (?,?,?,?,?,?,?)`,
      [
        str(row.id),
        str(row.job_id),
        str(row.technician_id),
        str(row.technician_name),
        str(row.technician_sn),
        str(row.assigned_at),
        flag01(row.is_lead),
      ]
    );
  }

  const insertHandovers = wb.getWorksheet(SCOPE_HANDOVER_SHEET[scope])?.rows ?? [];
  for (const row of insertHandovers) {
    await conn.query(
      `INSERT INTO job_handovers (id, job_id, handover_order, title, done, note, user_id, user_name, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        str(row.id),
        str(row.job_id),
        num(row.order),
        str(row.title),
        flag01(row.done),
        str(row.note),
        str(row.user_id),
        str(row.user_name),
        str(row.updated_at),
      ]
    );
  }

  const insertLoans = wb.getWorksheet(SCOPE_PART_LOAN_SHEET[scope])?.rows ?? [];
  for (const row of insertLoans) {
    await conn.query(
      `INSERT INTO job_part_loans (id, job_id, loan_order, part_name, status, note, user_id, user_name, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        str(row.id),
        str(row.job_id),
        num(row.order),
        str(row.part_name),
        str(row.status) || "open",
        str(row.note),
        str(row.user_id),
        str(row.user_name),
        str(row.updated_at),
      ]
    );
  }
}

export async function relationalHasData(): Promise<boolean> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT 1 AS ok FROM users LIMIT 1`
  );
  if (rows.length > 0) return true;
  const [jobs] = await p.query<mysql.RowDataPacket[]>(
    `SELECT 1 AS ok FROM jobs LIMIT 1`
  );
  return jobs.length > 0;
}

export async function loadRelationalWorkbook(
  workbookName: string
): Promise<MysqlWorkbook> {
  const p = getPool();
  const wb = new MysqlWorkbook(workbookName);
  const kind = WORKBOOK_SCOPE[workbookName];
  if (!kind) throw new Error(`Unknown workbook: ${workbookName}`);

  if (kind === "backup") {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM job_change_backups ORDER BY at DESC`
    );
    const headers = [
      "id",
      "at",
      "user_id",
      "user_name",
      "user_level",
      "action",
      "entity",
      "entity_id",
      "job_id",
      "summary",
      "before_json",
      "after_json",
      "undone",
      "undone_at",
      "undone_by_user_id",
      "undone_by_user_name",
      "undone_by_user_level",
    ];
    setSheet(
      wb,
      "ChangeLog",
      headers,
      rows.map((r) => ({
        id: str(r.id),
        at: str(r.at),
        user_id: str(r.user_id),
        user_name: str(r.user_name),
        user_level: str(r.user_level),
        action: str(r.action),
        entity: str(r.entity),
        entity_id: str(r.entity_id),
        job_id: str(r.job_id),
        summary: str(r.summary),
        before_json: str(r.before_json),
        after_json: str(r.after_json),
        undone: flag01(r.undone) ? "1" : "0",
        undone_at: str(r.undone_at),
        undone_by_user_id: str(r.undone_by_user_id),
        undone_by_user_name: str(r.undone_by_user_name),
        undone_by_user_level: str(r.undone_by_user_level),
      }))
    );
    wb.dirty = false;
    return wb;
  }

  if (workbookName === "workshop") {
    const [techs] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM technicians ORDER BY name`
    );
    setSheet(wb, "Technicians", ["id", "name", "sn", "badge_id", "email", "status", "current_job_id", "phone"], techs.map((r) => ({
      id: str(r.id),
      name: str(r.name),
      sn: str(r.sn),
      badge_id: str(r.badge_id),
      email: str(r.email),
      status: str(r.status),
      current_job_id: str(r.current_job_id),
      phone: str(r.phone),
    })));

    const [units] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM units ORDER BY code`
    );
    setSheet(wb, "Units", ["id", "code", "name", "serial_number", "active"], units.map((r) => ({
      id: str(r.id),
      code: str(r.code),
      name: str(r.name),
      serial_number: str(r.serial_number),
      active: flag01(r.active) ? "1" : "0",
    })));

    const [users] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM users ORDER BY username`
    );
    setSheet(wb, "Users", ["id", "username", "password", "name", "email", "phone", "level", "active", "created_at"], users.map((r) => ({
      id: str(r.id),
      username: str(r.username),
      password: str(r.password_hash),
      name: str(r.name),
      email: str(r.email),
      phone: str(r.phone),
      level: str(r.level),
      active: flag01(r.active) ? "1" : "0",
      created_at: str(r.created_at),
    })));

    const [attendance] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM attendance ORDER BY attendance_date DESC`
    );
    setSheet(
      wb,
      "Attendance",
      [
        "id",
        "date",
        "technician_id",
        "technician_name",
        "pernr",
        "status",
        "dws",
        "check_in",
        "check_out",
        "absence",
        "note",
      ],
      attendance.map((r) => ({
        id: str(r.id),
        date: str(r.attendance_date),
        technician_id: str(r.technician_id),
        technician_name: str(r.technician_name),
        pernr: str(r.pernr),
        status: str(r.status),
        dws: str(r.dws),
        check_in: str(r.check_in),
        check_out: str(r.check_out),
        absence: str(r.absence),
        note: str(r.note),
      }))
    );

    const [audits] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM audit_log ORDER BY at`
    );
    setSheet(
      wb,
      "AuditLog",
      ["id", "at", "user_id", "user_name", "user_level", "action", "entity", "entity_id", "detail"],
      audits.map((r) => ({
        id: str(r.id),
        at: str(r.at),
        user_id: str(r.user_id),
        user_name: str(r.user_name),
        user_level: str(r.user_level),
        action: str(r.action),
        entity: str(r.entity),
        entity_id: str(r.entity_id),
        detail: str(r.detail),
      }))
    );
  }

  await loadScopedJobs(p, wb, kind as JobScope);
  wb.dirty = false;
  return wb;
}

export async function saveRelationalWorkbook(wb: MysqlWorkbook): Promise<void> {
  const p = getPool();
  const conn = await p.getConnection();
  const kind = WORKBOOK_SCOPE[wb.workbookName];
  if (!kind) throw new Error(`Unknown workbook: ${wb.workbookName}`);

  try {
    await conn.beginTransaction();
    await conn.query(`SET FOREIGN_KEY_CHECKS=0`);

    if (kind === "backup") {
      await conn.query(`DELETE FROM job_change_backups`);
      const rows = wb.getWorksheet("ChangeLog")?.rows ?? [];
      for (const row of rows) {
        await conn.query(
          `INSERT INTO job_change_backups (
            id, at, user_id, user_name, user_level, action, entity, entity_id, job_id,
            summary, before_json, after_json, undone, undone_at,
            undone_by_user_id, undone_by_user_name, undone_by_user_level
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            str(row.id),
            str(row.at),
            str(row.user_id),
            str(row.user_name),
            str(row.user_level),
            str(row.action),
            str(row.entity),
            str(row.entity_id),
            str(row.job_id),
            str(row.summary),
            str(row.before_json),
            str(row.after_json),
            flag01(row.undone),
            str(row.undone_at),
            str(row.undone_by_user_id),
            str(row.undone_by_user_name),
            str(row.undone_by_user_level),
          ]
        );
      }
    } else {
      if (wb.workbookName === "workshop") {
        await conn.query(`DELETE FROM technicians`);
        for (const row of wb.getWorksheet("Technicians")?.rows ?? []) {
          await conn.query(
            `INSERT INTO technicians (id, name, sn, badge_id, email, status, current_job_id, phone) VALUES (?,?,?,?,?,?,?,?)`,
            [
              str(row.id),
              str(row.name),
              str(row.sn),
              str(row.badge_id),
              str(row.email),
              str(row.status),
              str(row.current_job_id),
              str(row.phone),
            ]
          );
        }

        await conn.query(`DELETE FROM units`);
        for (const row of wb.getWorksheet("Units")?.rows ?? []) {
          await conn.query(
            `INSERT INTO units (id, code, name, serial_number, active) VALUES (?,?,?,?,?)`,
            [
              str(row.id),
              str(row.code),
              str(row.name),
              str(row.serial_number),
              flag01(row.active),
            ]
          );
        }

        await conn.query(`DELETE FROM users`);
        for (const row of wb.getWorksheet("Users")?.rows ?? []) {
          await conn.query(
            `INSERT INTO users (id, username, password_hash, name, email, phone, level, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
            [
              str(row.id),
              str(row.username),
              str(row.password),
              str(row.name),
              str(row.email),
              str(row.phone),
              str(row.level),
              flag01(row.active),
              str(row.created_at),
            ]
          );
        }

        await conn.query(`DELETE FROM attendance`);
        for (const row of wb.getWorksheet("Attendance")?.rows ?? []) {
          await conn.query(
            `INSERT INTO attendance (id, attendance_date, technician_id, technician_name, pernr, status, dws, check_in, check_out, absence, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              str(row.id),
              str(row.date),
              str(row.technician_id),
              str(row.technician_name),
              str(row.pernr),
              str(row.status),
              str(row.dws),
              str(row.check_in),
              str(row.check_out),
              str(row.absence),
              str(row.note),
            ]
          );
        }

        await conn.query(`DELETE FROM audit_log`);
        for (const row of wb.getWorksheet("AuditLog")?.rows ?? []) {
          await conn.query(
            `INSERT INTO audit_log (id, at, user_id, user_name, user_level, action, entity, entity_id, detail)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [
              str(row.id),
              str(row.at),
              str(row.user_id),
              str(row.user_name),
              str(row.user_level),
              str(row.action),
              str(row.entity),
              str(row.entity_id),
              str(row.detail),
            ]
          );
        }
      }

      await saveScopedJobs(conn, wb, kind as JobScope);
    }

    await conn.query(`SET FOREIGN_KEY_CHECKS=1`);
    await conn.commit();
    wb.dirty = false;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function ensureRelationalSchema() {
  const p = getPool();
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      name VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(64) NOT NULL DEFAULT '',
      level VARCHAR(32) NOT NULL DEFAULT 'teknisi',
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      UNIQUE KEY uk_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS technicians (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      sn VARCHAR(64) NOT NULL DEFAULT '',
      badge_id VARCHAR(64) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'offline',
      current_job_id VARCHAR(64) NOT NULL DEFAULT '',
      phone VARCHAR(64) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS units (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      code VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(255) NOT NULL DEFAULT '',
      serial_number VARCHAR(128) NOT NULL DEFAULT '',
      active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS jobs (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_scope ENUM('active','completed','cancelled','deleted') NOT NULL DEFAULT 'active',
      title VARCHAR(255) NOT NULL DEFAULT '',
      unit_label VARCHAR(255) NOT NULL DEFAULT '',
      unit_id VARCHAR(64) NOT NULL DEFAULT '',
      description TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      technician_id VARCHAR(64) NOT NULL DEFAULT '',
      template_id VARCHAR(64) NOT NULL DEFAULT '',
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      started_at VARCHAR(64) NOT NULL DEFAULT '',
      completed_at VARCHAR(64) NOT NULL DEFAULT '',
      paused_at VARCHAR(64) NOT NULL DEFAULT '',
      total_paused_sec INT NOT NULL DEFAULT 0,
      estimated_minutes INT NOT NULL DEFAULT 0,
      archived_at VARCHAR(64) NOT NULL DEFAULT '',
      archived_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
      archived_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
      archived_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
      deleted_at VARCHAR(64) NOT NULL DEFAULT '',
      deleted_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
      deleted_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
      deleted_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
      assigned_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
      assigned_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
      assigned_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
      delegated_to_user_id VARCHAR(64) NOT NULL DEFAULT '',
      delegated_to_user_name VARCHAR(255) NOT NULL DEFAULT '',
      delegated_at VARCHAR(64) NOT NULL DEFAULT '',
      delegated_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_jobs_scope (job_scope)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_assignees (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      technician_id VARCHAR(64) NOT NULL DEFAULT '',
      technician_name VARCHAR(255) NOT NULL DEFAULT '',
      technician_sn VARCHAR(64) NOT NULL DEFAULT '',
      assigned_at VARCHAR(64) NOT NULL DEFAULT '',
      is_lead TINYINT(1) NOT NULL DEFAULT 0,
      KEY idx_job_assignees_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_steps (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      step_order INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      started_at VARCHAR(64) NOT NULL DEFAULT '',
      completed_at VARCHAR(64) NOT NULL DEFAULT '',
      duration_sec INT NOT NULL DEFAULT 0,
      std_minutes INT NOT NULL DEFAULT 0,
      KEY idx_job_steps_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_events (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      type VARCHAR(64) NOT NULL DEFAULT '',
      note TEXT,
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      user_id VARCHAR(64) NOT NULL DEFAULT '',
      user_name VARCHAR(255) NOT NULL DEFAULT '',
      user_level VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_job_events_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_handovers (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      handover_order INT NOT NULL DEFAULT 0,
      title VARCHAR(255) NOT NULL DEFAULT '',
      done TINYINT(1) NOT NULL DEFAULT 0,
      note TEXT,
      user_id VARCHAR(64) NOT NULL DEFAULT '',
      user_name VARCHAR(255) NOT NULL DEFAULT '',
      updated_at VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_job_handovers_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_part_loans (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      loan_order INT NOT NULL DEFAULT 0,
      part_name VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      note TEXT,
      user_id VARCHAR(64) NOT NULL DEFAULT '',
      user_name VARCHAR(255) NOT NULL DEFAULT '',
      updated_at VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_job_part_loans_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      attendance_date VARCHAR(16) NOT NULL DEFAULT '',
      technician_id VARCHAR(64) NOT NULL DEFAULT '',
      technician_name VARCHAR(255) NOT NULL DEFAULT '',
      pernr VARCHAR(64) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'alpha',
      dws VARCHAR(64) NOT NULL DEFAULT '',
      check_in VARCHAR(32) NOT NULL DEFAULT '',
      check_out VARCHAR(32) NOT NULL DEFAULT '',
      absence VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT,
      KEY idx_attendance_date (attendance_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      at VARCHAR(64) NOT NULL DEFAULT '',
      user_id VARCHAR(64) NOT NULL DEFAULT '',
      user_name VARCHAR(255) NOT NULL DEFAULT '',
      user_level VARCHAR(64) NOT NULL DEFAULT '',
      action VARCHAR(64) NOT NULL DEFAULT '',
      entity VARCHAR(64) NOT NULL DEFAULT '',
      entity_id VARCHAR(64) NOT NULL DEFAULT '',
      detail TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS job_change_backups (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      at VARCHAR(64) NOT NULL DEFAULT '',
      user_id VARCHAR(64) NOT NULL DEFAULT '',
      user_name VARCHAR(255) NOT NULL DEFAULT '',
      user_level VARCHAR(64) NOT NULL DEFAULT '',
      action VARCHAR(64) NOT NULL DEFAULT '',
      entity VARCHAR(64) NOT NULL DEFAULT '',
      entity_id VARCHAR(64) NOT NULL DEFAULT '',
      job_id VARCHAR(64) NOT NULL DEFAULT '',
      summary TEXT,
      before_json LONGTEXT,
      after_json LONGTEXT,
      undone TINYINT(1) NOT NULL DEFAULT 0,
      undone_at VARCHAR(64) NOT NULL DEFAULT '',
      undone_by_user_id VARCHAR(64) NOT NULL DEFAULT '',
      undone_by_user_name VARCHAR(255) NOT NULL DEFAULT '',
      undone_by_user_level VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_job_change_backups_job (job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const sql of statements) {
    await p.query(sql);
  }
  const alters = [
    "assigned_by_user_id",
    "assigned_by_user_name",
    "assigned_by_user_level",
    "delegated_to_user_id",
    "delegated_to_user_name",
    "delegated_at",
    "delegated_by_user_id",
  ] as const;
  for (const col of alters) {
    const type =
      col.includes("_name") ? "VARCHAR(255)" : "VARCHAR(64)";
    await p.query(
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ${col} ${type} NOT NULL DEFAULT ''`
    );
  }
  await p.query(
    `ALTER TABLE technicians ADD COLUMN IF NOT EXISTS badge_id VARCHAR(64) NOT NULL DEFAULT ''`
  );
  await p.query(
    `ALTER TABLE technicians ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL DEFAULT ''`
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL DEFAULT ''`
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(64) NOT NULL DEFAULT ''`
  );
  await ensureListIndexes(p);
}

async function ensureListIndexes(p: mysql.Pool) {
  const indexes: Array<{ table: string; name: string; columns: string }> = [
    { table: "jobs", name: "idx_jobs_list", columns: "job_scope, status, created_at, id" },
    { table: "jobs", name: "idx_jobs_scope_created", columns: "job_scope, created_at, id" },
    { table: "jobs", name: "idx_jobs_assigned_by", columns: "assigned_by_user_id, job_scope" },
    { table: "jobs", name: "idx_jobs_delegated_to", columns: "delegated_to_user_id, job_scope" },
    { table: "technicians", name: "idx_technicians_status_name", columns: "status, name" },
    { table: "job_assignees", name: "idx_job_assignees_technician", columns: "technician_id" },
  ];
  for (const idx of indexes) {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
       LIMIT 1`,
      [idx.table, idx.name]
    );
    if (rows.length) continue;
    await p.query(
      `CREATE INDEX ${idx.name} ON ${idx.table} (${idx.columns})`
    );
  }
}
