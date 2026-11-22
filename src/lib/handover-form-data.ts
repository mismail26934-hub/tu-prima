import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { listJobsForExport } from "@/lib/board-list";
import { formatHandoverDate } from "@/lib/handover-form-format";
import type {
  Attendance,
  AttendanceStatus,
  JobWithDetails,
  Technician,
} from "@/lib/types";

export { formatHandoverDate } from "@/lib/handover-form-format";

export type HandoverFormCrewMember = {
  name: string;
  status: string;
  note?: string;
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

export function unitNoFromJob(job: Pick<JobWithDetails, "unit">): string {
  const label = String(job.unit || "").trim();
  if (!label) return "—";
  const parts = label.split(/\s*[—–-]\s*/);
  return (parts[0] || label).trim() || "—";
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
): { progress: string[]; handover: string[]; planIds: string[] } {
  const h = pickHandoverForShiftDate(job, shiftDate);
  if (!h) return { progress: [], handover: [], planIds: [] };
  return {
    progress: linesFromText(String(h.progress_text || "")),
    handover: linesFromText(String(h.handover_text || "")),
    planIds: h.plan_technician_ids || [],
  };
}

function mapAttendanceRow(r: mysql.RowDataPacket): Attendance {
  return {
    id: String(r.id || ""),
    date: String(r.attendance_date || r.date || ""),
    technician_id: String(r.technician_id || ""),
    technician_name: String(r.technician_name || ""),
    pernr: String(r.pernr || ""),
    status: String(r.status || "hadir") as AttendanceStatus,
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

function crewFromAttendance(
  rows: Attendance[],
  status: AttendanceStatus
): HandoverFormCrewMember[] {
  return rows
    .filter((a) => a.status === status)
    .map((a) => ({
      name: a.technician_name || a.technician_id || "—",
      status: a.status,
      note: a.note || a.absence || "",
    }));
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
  const planIds = jobs.flatMap((j) => {
    const form = formLinesFromHandover(j, ymd);
    return form.planIds;
  });
  const techById = await loadTechniciansById(planIds);
  const attendance = await loadAttendanceForDate(ymd);
  const nextCrewNames = new Set<string>();
  for (const j of jobs) {
    const form = formLinesFromHandover(j, ymd);
    for (const id of form.planIds) {
      const name = techById.get(id)?.name;
      if (name) nextCrewNames.add(name);
    }
  }

  return {
    date: ymd,
    printed_at: new Date().toISOString(),
    hadir: crewFromAttendance(attendance, "hadir"),
    sakit: crewFromAttendance(attendance, "sakit"),
    next_crew: Array.from(nextCrewNames).map((name) => ({
      name,
      status: "plan",
    })),
    units: jobs.map((j) => toUnitRow(j, techById, ymd)),
  };
}
