import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { listJobsForExport } from "@/lib/board-list";
import {
  formatHandoverDate,
  unitNoFromJob,
} from "@/lib/handover-form-format";
import type {
  Attendance,
  AttendanceStatus,
  JobWithDetails,
  Technician,
} from "@/lib/types";

export { formatHandoverDate, unitNoFromJob } from "@/lib/handover-form-format";

export type HandoverFormCrewMember = {
  name: string;
  status: string;
  note?: string;
  /** Pernr / SN when known (Next Crew column). */
  sn?: string;
};

export type HandoverFormUnitRow = {
  job_id: string;
  unit_no: string;
  priority: string;
  unit_in: string;
  est_dt: string;
  customer: string;
  smu: string;
  description: string;
  progress: string[];
  prev_mp: string[];
  handover: string[];
  plan_mp: string[];
};

export type HandoverFormPayload = {
  date: string;
  printed_at: string;
  /** Dominant current-shift label from handovers (e.g. Crew B). */
  current_shift_label: string;
  /** Dominant next-shift label from handovers (e.g. Crew A). */
  next_shift_label: string;
  /** Day/Night (or DWS) hint from attendance when available. */
  shift_period: string;
  hadir: HandoverFormCrewMember[];
  sakit: HandoverFormCrewMember[];
  next_crew: HandoverFormCrewMember[];
  units: HandoverFormUnitRow[];
};

export function resolveEstDt(job: Pick<JobWithDetails, "est_revision_at" | "promise_at">): string {
  const rev = String(job.est_revision_at || "").trim();
  if (rev) return formatHandoverDate(rev);
  return formatHandoverDate(String(job.promise_at || ""));
}

function linesFromText(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export function progressCandidateSteps(job: JobWithDetails) {
  return (job.steps || [])
    .filter((s) => s.status === "done" || s.status === "in_progress")
    .sort((a, b) => a.order - b.order);
}

export function handoverCandidateSteps(job: JobWithDetails) {
  return (job.steps || [])
    .filter((s) => s.status === "in_progress" || s.status === "pending")
    .sort((a, b) => a.order - b.order);
}

export function prevMpNames(job: JobWithDetails): string[] {
  if (job.technicians?.length) {
    return job.technicians.map((t) => t.name).filter(Boolean);
  }
  if (job.technician?.name) return [job.technician.name];
  return [];
}

/** Prefer handover row matching shift_date; else latest handover. */
export function pickHandoverForShiftDate(
  job: JobWithDetails,
  shiftDate: string
) {
  const ymd = String(shiftDate || "").slice(0, 10);
  const list = [...(job.handovers || [])].sort((a, b) => b.order - a.order);
  const onDate = list.filter((h) => String(h.shift_date || "").slice(0, 10) === ymd);
  return onDate[0] || list[0] || null;
}

function formLinesFromHandover(
  job: JobWithDetails,
  shiftDate: string
): {
  progress: string[];
  handover: string[];
  planIds: string[];
  nextCrewIds: string[];
  from_shift_name: string;
  to_shift_name: string;
} {
  const h = pickHandoverForShiftDate(job, shiftDate);
  if (!h) {
    return {
      progress: [],
      handover: [],
      planIds: [],
      nextCrewIds: [],
      from_shift_name: "",
      to_shift_name: "",
    };
  }
  return {
    progress: linesFromText(String(h.progress_text || "")),
    handover: linesFromText(String(h.handover_text || "")),
    planIds: h.plan_technician_ids || [],
    nextCrewIds: h.next_crew_technician_ids || [],
    from_shift_name: String(h.from_shift_name || "").trim(),
    to_shift_name: String(h.to_shift_name || "").trim(),
  };
}

function majorityLabel(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const raw of labels) {
    const k = String(raw || "").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

/** Short code for header (Crew B → B, Night → Night). */
export function shiftShortCode(label: string): string {
  const s = String(label || "").trim();
  if (!s) return "";
  const crew = s.match(/\bcrew\s*([A-Za-z0-9]+)\b/i);
  if (crew?.[1]) return crew[1].toUpperCase();
  if (s.length <= 4) return s.toUpperCase();
  return s;
}

function mapAttendanceRow(r: mysql.RowDataPacket): Attendance {
  const rawStatus = String(r.status || "hadir").trim().toLowerCase();
  return {
    id: String(r.id || ""),
    date: String(r.attendance_date || r.date || ""),
    technician_id: String(r.technician_id || ""),
    technician_name: String(r.technician_name || ""),
    pernr: String(r.pernr || ""),
    status: (rawStatus || "hadir") as AttendanceStatus,
    dws: String(r.dws || ""),
    check_in: String(r.check_in || ""),
    check_out: String(r.check_out || ""),
    absence: String(r.absence || ""),
    note: String(r.note || ""),
  };
}

async function loadAttendanceForDate(date: string): Promise<Attendance[]> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM attendance WHERE attendance_date = ? ORDER BY technician_name ASC`,
    [date]
  );
  return rows.map(mapAttendanceRow);
}

/**
 * Controlling foreman for a job's crew:
 * Delegasi if set, otherwise Penugas (assigned_by).
 */
export function controllingForemanId(
  job: Pick<JobWithDetails, "assigned_by_user_id" | "delegated_to_user_id">
): string {
  const delegated = String(job.delegated_to_user_id || "").trim();
  if (delegated) return delegated;
  return String(job.assigned_by_user_id || "").trim();
}

/** Technicians whose superior is one of the given foreman user ids. */
async function loadTechniciansBySuperior(
  superiorUserIds: string[]
): Promise<{ ids: Set<string>; names: Set<string> }> {
  const unique = [...new Set(superiorUserIds.map(String).filter(Boolean))];
  const ids = new Set<string>();
  const names = new Set<string>();
  if (!unique.length) return { ids, names };
  const p = getPool();
  const ph = unique.map(() => "?").join(",");
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, name FROM technicians WHERE superior_user_id IN (${ph})`,
    unique
  );
  for (const r of rows) {
    const id = String(r.id || "").trim();
    const name = String(r.name || "").trim().toLowerCase();
    if (id) ids.add(id);
    if (name) names.add(name);
  }
  return { ids, names };
}

/**
 * Attendance for Hadir / Other Status:
 * - Prefer technicians under controlling foremen (Delegasi || Penugas)
 * - Also include assignees on those foremen's jobs
 * - Match by technician_id or technician_name (attendance ids can drift)
 * - If no foreman on jobs, or filter yields nothing while attendance exists →
 *   fall back to all attendance so the form is not blank
 */
function resolveCrewAttendance(
  attendanceAll: Attendance[],
  jobs: JobWithDetails[],
  crewTechIds: Set<string>,
  crewTechNames: Set<string>,
  foremanIds: string[]
): Attendance[] {
  if (!attendanceAll.length) return [];

  // Collect assignees on jobs owned by those foremen (or all jobs if no foreman ids)
  const assigneeIds = new Set<string>();
  const assigneeNames = new Set<string>();
  for (const j of jobs) {
    const owner = controllingForemanId(j);
    if (foremanIds.length && owner && !foremanIds.includes(owner)) continue;
    for (const t of j.technicians || []) {
      if (t.id) assigneeIds.add(String(t.id));
      const n = String(t.name || "").trim().toLowerCase();
      if (n) assigneeNames.add(n);
    }
    if (j.technician?.id) assigneeIds.add(String(j.technician.id));
    const single = String(j.technician?.name || "").trim().toLowerCase();
    if (single) assigneeNames.add(single);
  }

  const idAllow = new Set([...crewTechIds, ...assigneeIds]);
  const nameAllow = new Set([...crewTechNames, ...assigneeNames]);

  const filtered = attendanceAll.filter((a) => {
    const tid = String(a.technician_id || "").trim();
    const tname = String(a.technician_name || "").trim().toLowerCase();
    if (tid && idAllow.has(tid)) return true;
    if (tname && nameAllow.has(tname)) return true;
    return false;
  });

  // No penugas/delegasi on jobs → cannot scope; show all attendance
  if (!foremanIds.length) return attendanceAll;

  // Scoped filter empty but data exists → superior links likely incomplete; show all
  if (!filtered.length && attendanceAll.length) return attendanceAll;

  return filtered;
}

async function loadTechniciansById(
  ids: string[]
): Promise<Map<string, Technician>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Technician>();
  if (!unique.length) return map;
  const p = getPool();
  const ph = unique.map(() => "?").join(",");
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, name, sn, badge_id, email, phone, status, current_job_id, superior_user_id, superior_user_name, user_id
     FROM technicians WHERE id IN (${ph})`,
    unique
  );
  for (const r of rows) {
    map.set(String(r.id), {
      id: String(r.id || ""),
      name: String(r.name || ""),
      sn: String(r.sn || ""),
      badge_id: String(r.badge_id || ""),
      email: String(r.email || ""),
      phone: String(r.phone || ""),
      status: (String(r.status || "available") as Technician["status"]),
      current_job_id: String(r.current_job_id || ""),
      superior_user_id: String(r.superior_user_id || ""),
      superior_user_name: String(r.superior_user_name || ""),
      user_id: String(r.user_id || ""),
    });
  }
  return map;
}

/** Statuses that mean not available → Other Status panel. */
export const OTHER_STATUS_ATTENDANCE: AttendanceStatus[] = [
  "sakit",
  "izin",
  "off",
  "alpha",
];

function capitalizeStatus(status: string): string {
  const s = String(status || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function crewFromAttendance(
  rows: Attendance[],
  statuses: AttendanceStatus | AttendanceStatus[]
): HandoverFormCrewMember[] {
  const set = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  return rows
    .filter((a) => set.has(a.status))
    .map((a) => ({
      name: a.technician_name || a.technician_id || "—",
      status: a.status,
      note: a.note || a.absence || "",
      sn: a.pernr || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/** Label shown in Other Status third column (Sakit / Izin / Off / Alpha / note). */
export function otherStatusLabel(member: HandoverFormCrewMember): string {
  const note = String(member.note || "").trim();
  if (note) return note;
  return capitalizeStatus(member.status) || "Other";
}

function toUnitRow(
  job: JobWithDetails,
  techById: Map<string, Technician>,
  shiftDate: string
): HandoverFormUnitRow {
  const smu = Number(job.smu || 0);
  const form = formLinesFromHandover(job, shiftDate);
  const plan_mp = form.planIds
    .map((id) => techById.get(id)?.name || "")
    .filter(Boolean);
  return {
    job_id: job.id,
    unit_no: unitNoFromJob(job),
    priority: String(job.priority || "").trim() || "—",
    unit_in: formatHandoverDate(String(job.arrived_at || "")),
    est_dt: resolveEstDt(job),
    customer: String(job.customer || "").trim(),
    smu: smu > 0 ? String(smu) : "",
    description: String(job.description || job.title || "").trim(),
    progress: form.progress,
    prev_mp: prevMpNames(job),
    handover: form.handover,
    plan_mp,
  };
}

/** Build Hand Over Form payload for a calendar date (YYYY-MM-DD). */
export async function buildHandoverFormPayload(
  date: string
): Promise<HandoverFormPayload> {
  const ymd = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error("Tanggal harus YYYY-MM-DD");
  }

  const jobs = await listJobsForExport([
    "assigned",
    "in_progress",
    "paused",
  ]);
  const snapshotNextCrewIds: string[] = [];
  const planIds: string[] = [];
  for (const j of jobs) {
    const form = formLinesFromHandover(j, ymd);
    planIds.push(...form.planIds);
    snapshotNextCrewIds.push(...form.nextCrewIds);
  }

  // Crew panels: technicians under controlling foreman (Delegasi || Penugas)
  // plus assignees on those jobs; fall back if filter would blank the form.
  const foremanIds = [
    ...new Set(jobs.map((j) => controllingForemanId(j)).filter(Boolean)),
  ];
  const { ids: crewTechIds, names: crewTechNames } =
    await loadTechniciansBySuperior(foremanIds);

  // Prefer handover Next Crew snapshots; fall back to live foreman roster
  // for legacy rows that predate next_crew_technician_ids.
  const nextCrewSourceIds = snapshotNextCrewIds.length
    ? snapshotNextCrewIds
    : [...crewTechIds];

  const techById = await loadTechniciansById([
    ...planIds,
    ...nextCrewSourceIds,
  ]);
  const attendanceAll = await loadAttendanceForDate(ymd);
  const attendance = resolveCrewAttendance(
    attendanceAll,
    jobs,
    crewTechIds,
    crewTechNames,
    foremanIds
  );

  const fromShiftLabels: string[] = [];
  const toShiftLabels: string[] = [];
  for (const j of jobs) {
    const form = formLinesFromHandover(j, ymd);
    if (form.from_shift_name) fromShiftLabels.push(form.from_shift_name);
    if (form.to_shift_name) toShiftLabels.push(form.to_shift_name);
  }

  const nextCrewById = new Map<string, HandoverFormCrewMember>();
  for (const id of nextCrewSourceIds) {
    if (nextCrewById.has(id)) continue;
    const tech = techById.get(id);
    if (!tech?.name) continue;
    nextCrewById.set(id, {
      name: tech.name,
      status: "crew",
      sn: tech.sn || tech.badge_id || "",
    });
  }

  const shift_period =
    attendance.map((a) => String(a.dws || "").trim()).find(Boolean) ||
    attendanceAll.map((a) => String(a.dws || "").trim()).find(Boolean) ||
    "";

  return {
    date: ymd,
    printed_at: new Date().toISOString(),
    current_shift_label: majorityLabel(fromShiftLabels),
    next_shift_label: majorityLabel(toShiftLabels),
    shift_period,
    hadir: crewFromAttendance(attendance, "hadir"),
    // Not available on that date → Other Status (same foreman crew)
    sakit: crewFromAttendance(attendance, OTHER_STATUS_ATTENDANCE),
    next_crew: Array.from(nextCrewById.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "id")
    ),
    units: jobs.map((j) => toUnitRow(j, techById, ymd)),
  };
}
