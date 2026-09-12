import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { JobWithDetails } from "@/lib/types";
import {
  calcElapsedSec,
  calcStepElapsedSec,
  formatDuration,
} from "@/lib/duration";
import { stepTechnicianNames } from "@/lib/step-technicians";
import { stepHasPhoto, stepPhotoCount } from "@/lib/step-photo-url";
import {
  formatStepNotesReport,
  hydrateStepNotes,
} from "@/lib/step-notes";
import { getStepPhotoPreviews, stepPhotoDisplayUrl } from "@/lib/offline/step-photo-preview";
import { fmtFileStamp } from "@/lib/file-stamp";

/** Light-mode brand: black bars, CAT orange text. */
const PDF_INK = [0, 0, 0] as [number, number, number];
const PDF_ORANGE = [255, 184, 28] as [number, number, number];

function formatPdfStatus(status: string): string {
  switch (String(status || "").trim()) {
    case "in_progress":
      return "In progress";
    case "pending":
      return "Pending";
    case "done":
      return "Done";
    case "queued":
      return "Queued";
    case "assigned":
      return "Assigned";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    default:
      return status || "—";
  }
}

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

type PdfImage = {
  data: string;
  format: "JPEG" | "PNG";
  width: number;
  height: number;
};

function uniqueUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const url = String(value || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function measureImageSize(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        reject(new Error("no size"));
        return;
      }
      resolve({ width, height });
    };
    img.onerror = () => reject(new Error("measure failed"));
    img.src = dataUrl;
  });
}

function fitImageBox(
  natW: number,
  natH: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  const ratio = natW / Math.max(1, natH);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

function stepEvidenceUrls(step: {
  id: string;
  photos?: Array<{ url?: string }>;
  photo_url?: string;
}): string[] {
  const saved = uniqueUrls([
    ...(step.photos || []).map((p) => p.url),
    step.photo_url,
  ]);
  return saved.length ? saved : uniqueUrls(getStepPhotoPreviews(step.id));
}

type EvidenceCard = {
  image: PdfImage | null;
  indexInStep: number;
  totalInStep: number;
};

type EvidenceGroup = {
  stepOrder: number;
  stepName: string;
  cards: EvidenceCard[];
};

async function loadPdfImage(url: string): Promise<PdfImage | null> {
  if (!url) return null;
  try {
    let dataUrl = url;
    let mime = "";
    if (!url.startsWith("data:")) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      mime = blob.type || "image/jpeg";
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
    } else {
      mime = url.slice(5, url.indexOf(";")) || "image/jpeg";
    }
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const format: "JPEG" | "PNG" = mime.includes("png") ? "PNG" : "JPEG";
    let width = 0;
    let height = 0;
    try {
      const size = await measureImageSize(dataUrl);
      width = size.width;
      height = size.height;
    } catch {
      /* keep 0 — caller falls back to a square box */
    }
    return { data: base64, format, width, height };
  } catch {
    return null;
  }
}

/** Generate and download a PDF report for one job. */
export async function downloadJobPdf(job: JobWithDetails): Promise<void> {
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
    ["Priority", job.priority || "—"],
    ["Status", formatPdfStatus(job.status)],
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

  const tableTheme = {
    theme: "grid" as const,
    styles: {
      font: "helvetica",
      fontStyle: "bold" as const,
      fontSize: 9,
      cellPadding: 1.8,
      textColor: PDF_INK,
      lineColor: PDF_INK,
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: PDF_INK,
      textColor: PDF_ORANGE,
      fontStyle: "bold" as const,
      fontSize: 9,
    },
    bodyStyles: {
      textColor: PDF_INK,
      fontStyle: "bold" as const,
    },
  };

  sectionTitle("Tahapan (Steps)");
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [["NO", "Step", "STP / Std", "Status", "Durasi", "Teknisi", "Note", "Bukti\nFoto"]],
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
      formatPdfStatus(s.status),
      formatDuration(calcStepElapsedSec(s)),
      stepTechnicianNames(s, job) || "—",
      formatStepNotesReport(hydrateStepNotes(s)).trim() || "—",
      stepHasPhoto(s) || stepPhotoDisplayUrl(s) || getStepPhotoPreviews(s.id).length
        ? String(Math.max(1, stepPhotoCount(s) || getStepPhotoPreviews(s.id).length))
        : "—",
    ]),
    ...tableTheme,
    columnStyles: {
      6: { valign: "top", fontStyle: "bold" },
      7: { cellWidth: 16, halign: "center", valign: "middle" },
    },
    bodyStyles: {
      ...tableTheme.bodyStyles,
      valign: "top",
    },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  sectionTitle(
    `Catatan handover (${(job.handovers || []).length})`
  );
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [["NO", "Job Handover", "Dari", "Ditujukan kepada", "Done", "Note"]],
    body:
      (job.handovers || []).length > 0
        ? (job.handovers || []).map((h) => [
            String(h.order),
            h.title,
            h.from_name || h.user_name || "—",
            h.to_name || "—",
            h.done === "1" ? "Yes" : "No",
            h.note || "—",
          ])
        : [["—", "Belum ada catatan handover", "—", "—", "—", "—"]],
    ...tableTheme,
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  sectionTitle(
    `Catatan peminjaman part (${(job.part_loans || []).length})`
  );
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [["NO", "Part yang dipinjam", "Status", "Note"]],
    body:
      (job.part_loans || []).length > 0
        ? (job.part_loans || []).map((p) => [
            String(p.order),
            p.part_name,
            formatPdfStatus(p.status),
            p.note || "—",
          ])
        : [["—", "Belum ada catatan peminjaman part", "—", "—"]],
    ...tableTheme,
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY + 6;

  const photoSteps = (job.steps || []).filter(
    (s) => stepHasPhoto(s) || getStepPhotoPreviews(s.id).length > 0
  );
  const evidenceGroups: EvidenceGroup[] = [];
  for (const s of photoSteps) {
    const urls = stepEvidenceUrls(s);
    const totalInStep = Math.max(1, urls.length);
    const cards: EvidenceCard[] = [];
    if (!urls.length) {
      cards.push({ image: null, indexInStep: 1, totalInStep: 1 });
    } else {
      for (let i = 0; i < urls.length; i++) {
        cards.push({
          image: await loadPdfImage(urls[i]),
          indexInStep: i + 1,
          totalInStep,
        });
      }
    }
    evidenceGroups.push({
      stepOrder: s.order,
      stepName: s.name,
      cards,
    });
  }
  const evidencePhotoCount = evidenceGroups.reduce(
    (n, g) => n + g.cards.length,
    0
  );

  if (evidenceGroups.length) {
    const pageH = doc.internal.pageSize.getHeight();
    const footerReserve = 12;
    const colGap = 6;
    const contentW = pageW - margin * 2;
    const cardW = (contentW - colGap) / 2;
    const frameH = 58;
    const captionH = 10;
    const cardH = frameH + 3 + captionH;
    const rowGap = 5;
    const groupGap = 8;

    const drawLampiranBanner = (continued: boolean) => {
      y = margin;
      doc.setFillColor(...PDF_INK);
      doc.rect(margin, y, contentW, 11, "F");
      doc.setTextColor(...PDF_ORANGE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(
        continued
          ? "Lampiran — Bukti foto (lanjutan)"
          : "Lampiran — Bukti foto",
        margin + 3,
        y + 7.4
      );
      doc.setTextColor(0);
      y += 15;
      if (!continued) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...PDF_INK);
        const sub = [
          job.unit,
          job.title,
          `${evidenceGroups.length} step  ·  ${evidencePhotoCount} foto`,
        ]
          .map((part) => String(part || "").trim())
          .filter(Boolean)
          .join("  ·  ");
        const subLines = doc.splitTextToSize(sub, contentW);
        doc.text(subLines, margin, y);
        y += subLines.length * 4.5 + 5;
      }
    };

    const stepHeaderHeight = (name: string, continued: boolean) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const label = continued
        ? `Step ${name}  (lanjutan)`
        : name;
      const lines = doc.splitTextToSize(label, contentW - 32);
      return Math.max(9, 5 + lines.length * 4.2);
    };

    const drawStepHeader = (group: EvidenceGroup, continued: boolean) => {
      const title = continued
        ? `Step ${group.stepOrder}. ${group.stepName}  (lanjutan)`
        : `Step ${group.stepOrder}. ${group.stepName}`;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const titleLines = doc.splitTextToSize(title, contentW - 32);
      const h = Math.max(9, 5 + titleLines.length * 4.2);
      doc.setFillColor(...PDF_INK);
      doc.rect(margin, y, contentW, h, "F");
      doc.setTextColor(...PDF_ORANGE);
      doc.text(titleLines, margin + 3, y + 5.6);
      doc.setFontSize(8);
      const countLabel = `${group.cards.length} foto`;
      doc.text(countLabel, margin + contentW - 3, y + 5.8, { align: "right" });
      doc.setTextColor(0);
      y += h + 3.5;
    };

    const drawCard = (card: EvidenceCard, col: number, rowY: number) => {
      const x = margin + col * (cardW + colGap);
      doc.setFillColor(246, 247, 250);
      doc.setDrawColor(...PDF_INK);
      doc.setLineWidth(0.28);
      doc.rect(x, rowY, cardW, frameH, "FD");
      if (card.image) {
        const pad = 2.2;
        const { w, h } = fitImageBox(
          card.image.width || 4,
          card.image.height || 3,
          cardW - pad * 2,
          frameH - pad * 2
        );
        const ix = x + (cardW - w) / 2;
        const iy = rowY + (frameH - h) / 2;
        try {
          doc.addImage(
            card.image.data,
            card.image.format,
            ix,
            iy,
            w,
            h,
            undefined,
            "FAST"
          );
        } catch {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text("Foto tidak bisa disematkan.", x + cardW / 2, rowY + frameH / 2, {
            align: "center",
          });
          doc.setTextColor(0);
        }
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text("Foto tidak bisa dimuat.", x + cardW / 2, rowY + frameH / 2, {
          align: "center",
        });
        doc.setTextColor(0);
      }
      const caption =
        card.totalInStep > 1
          ? `Foto ${card.indexInStep} dari ${card.totalInStep}`
          : "Foto 1";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...PDF_INK);
      doc.text(caption, x, rowY + frameH + 4.5);
      doc.setTextColor(0);
    };

    doc.addPage();
    drawLampiranBanner(false);

    for (let g = 0; g < evidenceGroups.length; g++) {
      const group = evidenceGroups[g];
      const headH = stepHeaderHeight(
        `Step ${group.stepOrder}. ${group.stepName}`,
        false
      );
      if (y + headH + 3.5 + cardH > pageH - footerReserve) {
        doc.addPage();
        drawLampiranBanner(true);
      }
      drawStepHeader(group, false);

      for (let i = 0; i < group.cards.length; i += 2) {
        if (y + cardH > pageH - footerReserve) {
          doc.addPage();
          drawLampiranBanner(true);
          drawStepHeader(group, true);
        }
        const rowY = y;
        drawCard(group.cards[i], 0, rowY);
        if (group.cards[i + 1]) drawCard(group.cards[i + 1], 1, rowY);
        y = rowY + cardH + rowGap;
      }

      if (g < evidenceGroups.length - 1) {
        y += groupGap;
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.line(margin, y - 3, pageW - margin, y - 3);
      }
    }
  }

  const pageCount = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(210, 214, 220);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text("TU-PRIMA  ·  Job Report", margin, pageH - 6);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageW - margin, pageH - 6, {
      align: "right",
    });
    doc.setTextColor(0);
  }

  const fileName = `job_${safeFilePart(job.unit || job.id)}_${safeFilePart(
    job.title || "report"
  )}_${fmtFileStamp()}.pdf`;
  doc.save(fileName);
}
