import ExcelJS from "exceljs";
import type { JobStatus, JobWithDetails } from "@/lib/types";
import { getDashboard } from "@/lib/excel";
import {
  calcElapsedSec,
  calcStepElapsedSec,
  formatDuration,
} from "@/lib/duration";

export type JobReportScope = "active" | "queue";

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

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF111827" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
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
    .map(
      (s) =>
        `${s.order}. ${s.name} [${s.status}] ${formatDuration(
          calcStepElapsedSec(s)
        )}`
    )
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

/** Satu file per scope: 1 sheet detail lengkap (+ Petunjuk). */
export async function buildJobsReportBuffer(
  scope: JobReportScope
): Promise<{ buffer: ExcelJS.Buffer; filename: string; count: number }> {
  const dashboard = await getDashboard();
  const statuses = SCOPE_STATUSES[scope];
  const jobs = dashboard.jobs
    .filter((j) => statuses.includes(j.status))
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
  guide.addRow([`Jumlah job: ${jobs.length}`]);
  guide.addRow([
    "Semua detail (teknisi, steps, handover, peminjaman part) ada di satu sheet.",
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
    { header: "elapsed", key: "elapsed", width: 12 },
    { header: "progress_pct", key: "progress_pct", width: 12 },
    { header: "description", key: "description", width: 36 },
    { header: "template_id", key: "template_id", width: 22 },
    { header: "created_at", key: "created_at", width: 22 },
    { header: "started_at", key: "started_at", width: 22 },
    { header: "paused_at", key: "paused_at", width: 22 },
    { header: "completed_at", key: "completed_at", width: 22 },
    { header: "steps", key: "steps", width: 48 },
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
    const row = sheet.addRow({
      job_id: job.id,
      title: job.title,
      unit: job.unit,
      status: job.status,
      kelompok,
      teknisi: techNames(job),
      estimated_minutes: job.estimated_minutes,
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
