import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { JobWithDetails } from "@/lib/types";
import {
  calcElapsedSec,
  calcStepElapsedSec,
  formatDuration,
} from "@/lib/duration";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48);
}

/** Generate and download a PDF report for one job. */
export function downloadJobPdf(job: JobWithDetails): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("TU-PRIMA — Job Report", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Dicetak: ${fmtDate(new Date().toISOString())}`, margin, y);
  doc.setTextColor(0);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const titleLines = doc.splitTextToSize(job.title || "Untitled job", pageW - margin * 2);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 6 + 2;

  const techNames = job.technicians?.length
    ? job.technicians.map((t) => t.name).join(", ")
    : job.technician?.name || "Belum diassign";
  const elapsed = formatDuration(calcElapsedSec(job));
  const remainSec = Math.max(
    0,
    (job.estimated_minutes || 0) * 60 - calcElapsedSec(job)
  );
  const overtime =
    calcElapsedSec(job) > (job.estimated_minutes || 0) * 60
      ? ` (overtime ${formatDuration(
          calcElapsedSec(job) - (job.estimated_minutes || 0) * 60
        )})`
      : "";

  const meta: Array<[string, string]> = [
    ["Unit", job.unit || "—"],
    ["Status", job.status],
    ["Teknisi", techNames],
    ["Estimasi", `${job.estimated_minutes || 0} menit`],
    ["Elapsed", `${elapsed}${overtime}`],
    ["Sisa estimasi", formatDuration(remainSec)],
    ["Progress", `${job.progress_pct}%`],
    ["Dibuat", fmtDate(job.created_at)],
    ["Start", fmtDate(job.started_at)],
    ["Selesai", fmtDate(job.completed_at)],
  ];

  doc.setFontSize(9);
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(value), pageW - margin * 2 - 32);
    doc.text(lines, margin + 32, y);
    y += Math.max(5, lines.length * 4.5);
  }

  if (job.description?.trim()) {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.text("Deskripsi:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const desc = doc.splitTextToSize(job.description.trim(), pageW - margin * 2);
    doc.text(desc, margin, y);
    y += desc.length * 4.5 + 4;
  }

  const ensureSpace = (need: number) => {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(16);
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, margin, y);
    y += 3;
    doc.setFontSize(9);
  };

  sectionTitle("Tahapan (Steps)");
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["NO", "Step", "STP / Std", "Status", "Durasi"]],
    body: (job.steps || []).map((s) => [
      String(s.order),
      s.name,
      Number(s.std_minutes || 0) > 0
        ? (() => {
            const total = Math.round(Number(s.std_minutes));
            const h = Math.floor(total / 60);
            const rem = total % 60;
            if (rem === 0) return `${h} jam`;
            if (h <= 0) return `${rem} mnt`;
            return `${h} jam ${rem} mnt`;
          })()
        : "—",
      s.status,
      formatDuration(calcStepElapsedSec(s)),
    ]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 48, 62], textColor: 255 },
    theme: "grid",
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  sectionTitle(
    `Catatan handover (${(job.handovers || []).length})`
  );
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["NO", "Job Handover", "Done", "Note"]],
    body:
      (job.handovers || []).length > 0
        ? (job.handovers || []).map((h) => [
            String(h.order),
            h.title,
            h.done === "1" ? "Yes" : "No",
            h.note || "—",
          ])
        : [["—", "Belum ada catatan handover", "—", "—"]],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 48, 62], textColor: 255 },
    theme: "grid",
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  sectionTitle(
    `Catatan peminjaman part (${(job.part_loans || []).length})`
  );
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["NO", "Part yang dipinjam", "Status", "Note"]],
    body:
      (job.part_loans || []).length > 0
        ? (job.part_loans || []).map((p) => [
            String(p.order),
            p.part_name,
            p.status,
            p.note || "—",
          ])
        : [["—", "Belum ada catatan peminjaman part", "—", "—"]],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [40, 48, 62], textColor: 255 },
    theme: "grid",
  });

  const fileName = `job_${safeFilePart(job.unit || job.id)}_${safeFilePart(
    job.title || "report"
  )}.pdf`;
  doc.save(fileName);
}
