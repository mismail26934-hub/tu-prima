import ExcelJS from "exceljs";
import type { JobStatus, JobWithDetails } from "@/lib/types";
import { getDashboard } from "@/lib/excel";
import {
  calcElapsedSec,
  calcStepElapsedSec,
  formatDuration,
} from "@/lib/duration";

export type JobReportScope = "active" | "queue";

export type JobReportDateField = "created" | "started" | "completed";

export type JobReportFilters = {
  dateField?: JobReportDateField;
  dateFrom?: string;
  dateTo?: string;
};

const SCOPE_STATUSES: Record<JobReportScope, JobStatus[]> = {
  active: ["in_progress", "paused"],
  queue: ["queued", "assigned"],
};

const SCOPE_LABEL: Record<JobReportScope, string> = {
  active: "Job Aktif",
  queue: "Job Antrian",
};

const SCOPE_SHEET: Record<JobReportScope, string> = {
  active: "Jobs_Aktif",
  queue: "Jobs_Antrian",
};

const DATE_FIELD_LABEL: Record<JobReportDateField, string> = {
  created: "Tanggal create job",
  started: "Tanggal start job",
  completed: "Tanggal end job",
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF111827" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
}

function formatStdLabel(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h} jam`;
  if (h <= 0) return `${rem} mnt`;
  return `${h} jam ${rem} mnt`;
}

function techNames(job: JobWithDetails): string {
  if (job.technicians?.length) {
    return job.technicians
      .map((t, i) => {
        const lead =
          t.id === job.technician_id || (i === 0 && !job.technician_id)
            ? " [lead]"
            : "";
        return `${t.name}${t.sn ? ` (${t.sn})` : ""}${lead}`;
      })
      .join("; ");
  }
  if (job.technician) {
    return `${job.technician.name}${
      job.technician.sn ? ` (${job.technician.sn})` : ""
    } [lead]`;
  }
  return "";
}

function stepsText(job: JobWithDetails): string {
  return (job.steps || [])
    .map((s) => {
      const stpMin = Number(s.std_minutes || 0);
      const stp =
        stpMin > 0
          ? ` | STP/Std Hours: ${formatStdLabel(stpMin)}`
          : " | STP/Std Hours: —";
      return `${s.order}. ${s.name}${stp} | [${s.status}] ${formatDuration(
        calcStepElapsedSec(s)
      )}`;
    })
    .join("\n");
}

function handoversText(job: JobWithDetails): string {
  return (job.handovers || [])
    .map(
      (h) =>
        `${h.order}. ${h.title} · Done=${h.done === "1" ? "Yes" : "No"}${
          h.note ? ` · Note=${h.note}` : ""
        }`
    )
    .join("\n");
}

function partLoansText(job: JobWithDetails): string {
  return (job.part_loans || [])
    .map(
      (p) =>
        `${p.order}. ${p.part_name} [${p.status}]${
          p.note ? ` · Note=${p.note}` : ""
        }`
    )
    .join("\n");
}

function jobDateValue(
  job: JobWithDetails,
  field: JobReportDateField
): string {
  if (field === "started") return job.started_at || "";
  if (field === "completed") return job.completed_at || "";
  return job.created_at || "";
}

function toDayKey(isoOrDate: string): string {
  const s = String(isoOrDate || "").trim();
  if (!s) return "";
  // Accept YYYY-MM-DD or full ISO
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function matchDateFilter(
  job: JobWithDetails,
  filters: JobReportFilters
): boolean {
  const from = toDayKey(filters.dateFrom || "");
  const to = toDayKey(filters.dateTo || "");
  if (!from && !to) return true;

  const field = filters.dateField || "created";
  const day = toDayKey(jobDateValue(job, field));
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** Satu file per scope: 1 sheet detail lengkap (+ Petunjuk). */
export async function buildJobsReportBuffer(
  scope: JobReportScope,
  filters: JobReportFilters = {}
): Promise<{ buffer: ExcelJS.Buffer; filename: string; count: number }> {
  const dashboard = await getDashboard();
  const statuses = SCOPE_STATUSES[scope];
  const dateField = filters.dateField || "created";
  const jobs = dashboard.jobs
    .filter((j) => statuses.includes(j.status))
    .filter((j) => matchDateFilter(j, { ...filters, dateField }))
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";
  workbook.created = new Date();

  addCombinedJobSheet(
    workbook,
    SCOPE_SHEET[scope],
    jobs,
    SCOPE_LABEL[scope]
  );

  const guide = workbook.addWorksheet("Petunjuk");
  guide.getColumn(1).width = 96;
  guide.addRow([`Laporan ${SCOPE_LABEL[scope]} — TU-PRIMA`]);
  guide.addRow([`Diekspor: ${new Date().toLocaleString("id-ID")}`]);
  guide.addRow([`Filter status: ${statuses.join(", ")}`]);
  guide.addRow([`Filter tanggal: ${DATE_FIELD_LABEL[dateField]}`]);
  guide.addRow([
    `Rentang: ${toDayKey(filters.dateFrom || "") || "—"} s/d ${
      toDayKey(filters.dateTo || "") || "—"
    }`,
  ]);
  guide.addRow([`Jumlah job: ${jobs.length}`]);
  guide.addRow([
    "Semua detail (teknisi, steps + STP/Std Hours, handover, peminjaman part) ada di satu sheet.",
  ]);
  guide.addRow([
    "Kolom estimated_minutes / stp_std_hours = total STP job. Kolom steps memuat STP per tahap.",
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename =
    scope === "active"
      ? `report-job-aktif-${stamp}.xlsx`
      : `report-job-antrian-${stamp}.xlsx`;

  return { buffer, filename, count: jobs.length };
}

function addCombinedJobSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  jobs: JobWithDetails[],
  kelompok: string
) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "job_id", key: "job_id", width: 38 },
    { header: "title", key: "title", width: 36 },
    { header: "unit", key: "unit", width: 24 },
    { header: "status", key: "status", width: 14 },
    { header: "kelompok", key: "kelompok", width: 12 },
    { header: "teknisi", key: "teknisi", width: 40 },
    { header: "estimated_minutes", key: "estimated_minutes", width: 16 },
    { header: "stp_std_hours", key: "stp_std_hours", width: 18 },
    { header: "elapsed", key: "elapsed", width: 12 },
    { header: "progress_pct", key: "progress_pct", width: 12 },
    { header: "description", key: "description", width: 36 },
    { header: "template_id", key: "template_id", width: 22 },
    { header: "created_at", key: "created_at", width: 22 },
    { header: "started_at", key: "started_at", width: 22 },
    { header: "paused_at", key: "paused_at", width: 22 },
    { header: "completed_at", key: "completed_at", width: 22 },
    { header: "steps", key: "steps", width: 56 },
    { header: "handovers", key: "handovers", width: 40 },
    { header: "part_loans", key: "part_loans", width: 40 },
  ];
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  for (const job of jobs) {
    const est = Number(job.estimated_minutes || 0);
    const row = sheet.addRow({
      job_id: job.id,
      title: job.title,
      unit: job.unit,
      status: job.status,
      kelompok,
      teknisi: techNames(job),
      estimated_minutes: est,
      stp_std_hours: formatStdLabel(est),
      elapsed: formatDuration(calcElapsedSec(job)),
      progress_pct: job.progress_pct,
      description: job.description,
      template_id: job.template_id || "",
      created_at: job.created_at,
      started_at: job.started_at,
      paused_at: job.paused_at,
      completed_at: job.completed_at,
      steps: stepsText(job),
      handovers: handoversText(job),
      part_loans: partLoansText(job),
    });
    row.alignment = { vertical: "top", wrapText: true };
    const lineCount = Math.max(
      1,
      (job.steps || []).length,
      (job.handovers || []).length,
      (job.part_loans || []).length,
      2
    );
    row.height = Math.min(20 + lineCount * 12, 120);
  }
}
