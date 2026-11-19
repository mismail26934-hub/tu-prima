import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  buildHandoverFormPayload,
  formatHandoverDate,
  type HandoverFormPayload,
} from "@/lib/handover-form-data";
import { fmtFileStamp } from "@/lib/file-stamp";

type JsPdfWithAutoTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

function bullets(lines: string[]): string {
  if (!lines.length) return "—";
  return lines.map((l) => `• ${l}`).join("\n");
}

function unitInfoCell(row: HandoverFormPayload["units"][number]): string {
  const bits = [
    `Unit No: ${row.unit_no}`,
    `Priority: ${row.priority}`,
    `Unit in: ${row.unit_in || "—"}`,
    `Est dt: ${row.est_dt || "—"}`,
  ];
  if (row.customer) bits.push(`Customer: ${row.customer}`);
  if (row.smu) bits.push(`SMU: ${row.smu}`);
  bits.push("");
  bits.push(row.description || "—");
  return bits.join("\n");
}

function crewTable(
  doc: JsPdfWithAutoTable,
  title: string,
  rows: { name: string; status: string; note?: string }[],
  startY: number,
  margin: number,
  width: number
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, margin, startY);
  autoTable(doc, {
    startY: startY + 2,
    margin: { left: margin, right: margin },
    tableWidth: width,
    head: [["Name", "Status / Ket"]],
    body: rows.length
      ? rows.map((r) => [r.name, r.note || r.status])
      : [["—", "—"]],
    styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak" },
    headStyles: {
      fillColor: [35, 41, 59],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 7,
    },
    theme: "grid",
  });
  return (doc.lastAutoTable?.finalY || startY) + 4;
}

export async function buildHandoverFormPdfBuffer(date: string): Promise<{
  buffer: Uint8Array;
  filename: string;
  payload: HandoverFormPayload;
}> {
  const payload = await buildHandoverFormPayload(date);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  }) as JsPdfWithAutoTable;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 10;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("HAND OVER FORM - MACHINE SECTION", pageW / 2, y, {
    align: "center",
  });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Date: ${formatHandoverDate(payload.date)}`, margin, y);
  doc.text(`Printed: ${formatHandoverDate(payload.printed_at)}`, pageW - margin, y, {
    align: "right",
  });
  doc.setTextColor(0);
  y += 6;

  const colW = (pageW - margin * 2 - 6) / 3;
  const y0 = y;
  const y1 = crewTable(doc, "Hadir", payload.hadir, y0, margin, colW);
  const y2 = crewTable(
    doc,
    "Sakit / Other",
    payload.sakit,
    y0,
    margin + colW + 3,
    colW
  );
  const y3 = crewTable(
    doc,
    "Next Crew",
    payload.next_crew,
    y0,
    margin + (colW + 3) * 2,
    colW
  );
  y = Math.max(y1, y2, y3) + 2;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Unit", "Progress", "Prev M/P", "Hand Over", "Plan M/P"]],
    body: payload.units.length
      ? payload.units.map((u) => [
          unitInfoCell(u),
          bullets(u.progress),
          bullets(u.prev_mp),
          bullets(u.handover),
          bullets(u.plan_mp),
        ])
      : [["Tidak ada job aktif", "—", "—", "—", "—"]],
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [30, 90, 160],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 55 },
      2: { cellWidth: 35 },
      3: { cellWidth: 55 },
      4: { cellWidth: 35 },
    },
    theme: "grid",
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageW - margin,
      doc.internal.pageSize.getHeight() - 6,
      { align: "right" }
    );
    doc.setTextColor(0);
  }

  const arrayBuf = doc.output("arraybuffer");
  const buffer = new Uint8Array(arrayBuf);
  const filename = `handover-form-${payload.date}_${fmtFileStamp()}.pdf`;
  return { buffer, filename, payload };
}
