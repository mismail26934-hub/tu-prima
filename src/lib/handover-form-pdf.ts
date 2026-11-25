import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  buildHandoverFormPayload,
  formatHandoverDate,
  otherStatusLabel,
  shiftShortCode,
  type HandoverFormCrewMember,
  type HandoverFormPayload,
  type HandoverFormUnitRow,
} from "@/lib/handover-form-data";
import { fmtFileStamp } from "@/lib/file-stamp";

type JsPdfWithAutoTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

const HEADER_BLUE: [number, number, number] = [168, 198, 224];
const HEADER_GREY: [number, number, number] = [220, 220, 220];
const HEADER_TEXT: [number, number, number] = [0, 0, 0];
const BODY_TEXT: [number, number, number] = [0, 0, 0];
const GRID: [number, number, number] = [40, 40, 40];
const PANEL_BORDER: [number, number, number] = [160, 180, 200];

function bullets(lines: string[]): string {
  if (!lines.length) return "";
  // Reference uses * prefix (not •)
  return lines.map((l) => `*${l}`).join("\n");
}

function printedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatHandoverDate(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function tryLoadLogoDataUrl(): string | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "trakindo-cat.png");
    if (!fs.existsSync(logoPath)) return null;
    const buf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const CREW_PER_COL = 10;
const CREW_HEAD_H = 5;

type CrewLine = { no: number; name: string; col3: string };

function splitCrewColumns(rows: CrewLine[]): [CrewLine[], CrewLine[]] {
  if (rows.length <= CREW_PER_COL) return [rows, []];
  return [rows.slice(0, CREW_PER_COL), rows.slice(CREW_PER_COL)];
}

function toHadirLines(rows: HandoverFormCrewMember[]): CrewLine[] {
  return rows.map((r, i) => ({
    no: i + 1,
    name: r.name,
    col3: "Hadir",
  }));
}

function toOtherLines(rows: HandoverFormCrewMember[]): CrewLine[] {
  return rows.map((r, i) => ({
    no: i + 1,
    name: r.name,
    col3: otherStatusLabel(r),
  }));
}

function toNextLines(rows: HandoverFormCrewMember[]): CrewLine[] {
  return rows.map((r, i) => ({
    no: i + 1,
    name: r.name,
    // Reference: SN / badge, or "Helper" when blank
    col3: String(r.sn || r.note || "").trim() || "Helper",
  }));
}

function periodLabel(payload: HandoverFormPayload): string {
  const p = String(payload.shift_period || "").trim();
  if (p) return p;
  const blob = `${payload.current_shift_label} ${payload.next_shift_label}`;
  if (/night/i.test(blob)) return "Night";
  if (/day/i.test(blob)) return "Day";
  return "";
}

function resetPdfColors(doc: jsPDF) {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(40, 40, 40);
  doc.setTextColor(...BODY_TEXT);
  doc.setLineWidth(0.2);
}

/** Fixed # | Name | col3 widths that always sum to `width` (no autoTable stretch). */
function crewColWidths(width: number): { noW: number; nameW: number; col3W: number } {
  const noW = Math.min(5.5, Math.max(4.2, width * 0.1));
  const col3W = Math.min(18, Math.max(12, width * 0.26));
  const nameW = Math.max(10, width - noW - col3W);
  return { noW, nameW, col3W };
}

function drawCrewBanner(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  title: string
): number {
  const pageW = doc.internal.pageSize.getWidth();
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW - x - width },
    tableWidth: width,
    body: [[title]],
    theme: "grid",
    styles: {
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      cellPadding: 1,
      textColor: BODY_TEXT,
      fillColor: HEADER_GREY,
      lineColor: GRID,
      lineWidth: 0.25,
      minCellHeight: CREW_HEAD_H,
      overflow: "ellipsize",
    },
    columnStyles: { 0: { cellWidth: width } },
  });
  resetPdfColors(doc);
  return doc.lastAutoTable?.finalY ?? y + CREW_HEAD_H;
}

/**
 * One crew list (# | Name | value).
 * Pass headLabels for header row; omit for body-only (right Next Crew column).
 */
function drawCrewListTable(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  headLabels: [string, string, string] | null,
  rows: CrewLine[],
  opts?: { separatorAfterLocalIndex?: number; highlightFirstName?: boolean }
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const { noW, nameW, col3W } = crewColWidths(width);
  const sepAfter = opts?.separatorAfterLocalIndex;
  const body = rows.map((r) => [String(r.no), r.name, r.col3 || ""]);

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW - x - width },
    tableWidth: width,
    ...(headLabels ? { head: [headLabels] } : {}),
    body,
    theme: "grid",
    styles: {
      fontSize: 6.5,
      cellPadding: 0.55,
      valign: "middle",
      textColor: BODY_TEXT,
      fillColor: [255, 255, 255],
      lineColor: GRID,
      lineWidth: 0.2,
      minCellHeight: 3.8,
      overflow: "ellipsize",
    },
    headStyles: {
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      fillColor: HEADER_GREY,
      textColor: BODY_TEXT,
      cellPadding: 1,
      minCellHeight: CREW_HEAD_H,
    },
    columnStyles: {
      0: { cellWidth: noW, halign: "center" },
      1: { cellWidth: nameW, halign: "left" },
      2: { cellWidth: col3W, halign: "left" },
    },
    didParseCell: (data) => {
      if (data.section === "head") {
        data.cell.styles.halign = "center";
      }
      // Reference: first Hadir name highlighted red
      if (
        opts?.highlightFirstName &&
        data.section === "body" &&
        data.row.index === 0 &&
        data.column.index === 1
      ) {
        data.cell.styles.fillColor = [220, 30, 30];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = "bold";
      }
      if (
        sepAfter != null &&
        data.section === "body" &&
        data.row.index === sepAfter
      ) {
        data.cell.styles.lineWidth = {
          bottom: 0.7,
          top: 0.2,
          left: 0.2,
          right: 0.2,
        };
      }
    },
  });
  resetPdfColors(doc);
  return doc.lastAutoTable?.finalY ?? y;
}

/**
 * Hadir header like reference: three cells [B] [20-Oct-26] [Night]
 * spanning the full panel — NOT a single "B · date · Hadir" banner.
 */
function drawHadirHeader(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  code: string,
  dateLabel: string,
  period: string
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const w1 = width * 0.14;
  const w2 = width * 0.48;
  const w3 = width - w1 - w2;
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW - x - width },
    tableWidth: width,
    body: [[code || "—", dateLabel || "", period || ""]],
    theme: "grid",
    styles: {
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      cellPadding: 1,
      textColor: BODY_TEXT,
      fillColor: HEADER_GREY,
      lineColor: GRID,
      lineWidth: 0.25,
      minCellHeight: CREW_HEAD_H,
      overflow: "ellipsize",
    },
    columnStyles: {
      0: { cellWidth: w1 },
      1: { cellWidth: w2 },
      2: { cellWidth: w3 },
    },
  });
  resetPdfColors(doc);
  return doc.lastAutoTable?.finalY ?? y + CREW_HEAD_H;
}

/**
 * Hadir panel (reference image 2):
 *  ≤10 rows: header B|date|Night + single #|Name|Hadir list
 *  >10 rows: header only above left (1–10); right (11–n) no header
 */
function drawHadirPanel(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  code: string,
  dateLabel: string,
  period: string,
  rows: CrewLine[]
): number {
  const gap = 1.2;
  const [left, right] = splitCrewColumns(rows);

  // Single column (≤10)
  if (!right.length) {
    const bodyY = drawHadirHeader(doc, x, y, width, code, dateLabel, period);
    if (!left.length) return bodyY;
    return drawCrewListTable(doc, x, bodyY, width, null, left, {
      highlightFirstName: true,
    });
  }

  // Dual newspaper columns when >10 (image 2)
  const colW = (width - gap) / 2;
  const bodyY = drawHadirHeader(doc, x, y, colW, code, dateLabel, period);
  const y1 = drawCrewListTable(doc, x, bodyY, colW, null, left, {
    highlightFirstName: true,
  });
  const y2 = drawCrewListTable(doc, x + colW + gap, bodyY, colW, null, right);
  return Math.max(y1, y2);
}

/**
 * Other Status panel (reference):
 *  Header: "Other Status" full width
 *  Body: # | Name | Sakit  (no second header row)
 */
function drawOtherStatusPanel(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  rows: CrewLine[]
): number {
  const bodyY = drawCrewBanner(doc, x, y, width, "Other Status");
  if (!rows.length) return bodyY;
  return drawCrewListTable(doc, x, bodyY, width, null, rows);
}

/** Next Crew column widths: # | Name | Helper/SN | Ket — sum to `width`. */
function nextCrewColWidths(width: number) {
  const noW = 4.5;
  const idW = Math.min(15, Math.max(11, width * 0.2));
  const ketW = Math.min(11, Math.max(8, width * 0.14));
  const nameW = Math.max(16, width - noW - idW - ketW);
  return { noW, nameW, idW, ketW };
}

/**
 * One Next Crew list — 4 cols matching reference image 2:
 *  body: # | Name | Helper|SN | Ket(empty)
 *  optional head: Next Crew: (span 2) | A | Ket
 */
function drawNextCrewList(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  rows: CrewLine[],
  opts: { shiftCode?: string; showHeader?: boolean }
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const { noW, nameW, idW, ketW } = nextCrewColWidths(width);
  const showHeader = Boolean(opts.showHeader);
  const shiftCode = opts.shiftCode || "—";

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW - x - width },
    tableWidth: width,
    ...(showHeader
      ? {
          head: [
            [
              {
                content: "Next Crew:",
                colSpan: 2,
                styles: { halign: "left" as const },
              },
              { content: shiftCode, styles: { halign: "center" as const } },
              { content: "Ket", styles: { halign: "center" as const } },
            ],
          ],
        }
      : {}),
    body: rows.map((r) => [
      String(r.no),
      r.name,
      r.col3 || "Helper",
      "",
    ]),
    theme: "grid",
    styles: {
      fontSize: 6.5,
      cellPadding: 0.5,
      valign: "middle",
      textColor: BODY_TEXT,
      fillColor: [255, 255, 255],
      lineColor: GRID,
      lineWidth: 0.2,
      minCellHeight: 3.9,
      overflow: "ellipsize",
    },
    headStyles: {
      fontSize: 7,
      fontStyle: "bold",
      fillColor: HEADER_GREY,
      textColor: BODY_TEXT,
      cellPadding: 1,
      minCellHeight: CREW_HEAD_H,
      lineWidth: 0.25,
      lineColor: GRID,
    },
    columnStyles: {
      0: { cellWidth: noW, halign: "center" },
      1: { cellWidth: nameW, halign: "left" },
      2: { cellWidth: idW, halign: "left", lineWidth: { left: 0.55, right: 0.2, top: 0.2, bottom: 0.2 } },
      3: { cellWidth: ketW, halign: "left" },
    },
    didParseCell: (data) => {
      // Thick rule after 4th body row (reference)
      if (data.section === "body" && data.row.index === 3) {
        data.cell.styles.lineWidth = {
          bottom: 0.75,
          top: 0.2,
          left: data.column.index === 2 ? 0.55 : 0.2,
          right: 0.2,
        };
      }
    },
  });
  resetPdfColors(doc);
  return doc.lastAutoTable?.finalY ?? y;
}

/** Header strip only: Next Crew: (span 2) | A | Ket */
function drawNextCrewHeader(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  shiftCode: string
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const { noW, nameW, idW, ketW } = nextCrewColWidths(width);
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW - x - width },
    tableWidth: width,
    body: [
      [
        {
          content: "Next Crew:",
          colSpan: 2,
          styles: {
            halign: "left",
            fontStyle: "bold",
            fillColor: HEADER_GREY,
            textColor: BODY_TEXT,
          },
        },
        {
          content: shiftCode || "—",
          styles: {
            halign: "center",
            fontStyle: "bold",
            fillColor: HEADER_GREY,
            textColor: BODY_TEXT,
          },
        },
        {
          content: "Ket",
          styles: {
            halign: "center",
            fontStyle: "bold",
            fillColor: HEADER_GREY,
            textColor: BODY_TEXT,
          },
        },
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 1,
      valign: "middle",
      minCellHeight: CREW_HEAD_H,
      lineColor: GRID,
      lineWidth: 0.25,
      overflow: "ellipsize",
    },
    columnStyles: {
      0: { cellWidth: noW },
      1: { cellWidth: nameW },
      2: { cellWidth: idW },
      3: { cellWidth: ketW },
    },
  });
  resetPdfColors(doc);
  return doc.lastAutoTable?.finalY ?? y + CREW_HEAD_H;
}

/**
 * Next Crew reference (image 2):
 *  Left:  header Next Crew:|A|Ket + rows 1–10 (#|Name|Helper|Ket)
 *  Right: no header, rows 11–n, top-aligned with left body
 */
function drawNextCrewPanel(
  doc: JsPdfWithAutoTable,
  x: number,
  y: number,
  width: number,
  shiftCode: string,
  rows: CrewLine[]
): number {
  const gap = 1.2;
  const [left, right] = splitCrewColumns(rows);

  if (!right.length) {
    // Single column: header + body together
    const bodyY = drawNextCrewHeader(doc, x, y, width, shiftCode);
    if (!left.length) return bodyY;
    return drawNextCrewList(doc, x, bodyY, width, left, { showHeader: false });
  }

  const colW = (width - gap) / 2;
  const bodyY = drawNextCrewHeader(doc, x, y, colW, shiftCode);
  const y1 = drawNextCrewList(doc, x, bodyY, colW, left, { showHeader: false });
  const y2 = drawNextCrewList(doc, x + colW + gap, bodyY, colW, right, {
    showHeader: false,
  });
  return Math.max(y1, y2);
}

function estimateUnitCardHeight(
  doc: jsPDF,
  unit: HandoverFormUnitRow,
  cardWidth: number
): number {
  // Reference: 2 meta rows (Unit No/Priority + Unit in/Est dt) + description
  const metaH = 10;
  const pad = 1;
  const desc = String(unit.description || "").trim() || "—";
  const lines = doc.splitTextToSize(desc, Math.max(12, cardWidth - 8));
  const descH = Math.max(5, lines.length * 3.1 + 2);
  return metaH + descH + pad;
}

/**
 * Unit block (reference — no column header above this):
 *  [#] Unit No | val | Unit in | val
 *      Priority | val | Est dt  | val
 *      description (full width)
 */
function drawUnitCard(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  unit: HandoverFormUnitRow,
  index: number
) {
  const idxW = 5;
  const rowH = 5;
  const innerX = x + idxW;
  const innerW = width - idxW;
  const labelW = Math.min(14, innerW * 0.22);
  const pairW = innerW / 2;
  const valueW = pairW - labelW;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, idxW, height, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BODY_TEXT);
  doc.text(String(index), x + idxW / 2, y + Math.min(height / 2, 8), {
    align: "center",
    baseline: "middle",
  });

  const fitValueFont = (text: string, maxW: number, bold = false) => {
    let size = 7.5;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    while (size > 5 && doc.getTextWidth(text) > maxW) {
      size -= 0.4;
      doc.setFontSize(size);
    }
  };

  const drawPair = (
    px: number,
    py: number,
    label: string,
    value: string,
    lw: number,
    vw: number,
    h: number,
    boldVal = false
  ) => {
    doc.setFillColor(...HEADER_BLUE);
    doc.setDrawColor(0, 0, 0);
    doc.rect(px, py, lw, h, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...BODY_TEXT);
    doc.text(label, px + 0.7, py + h / 2, { baseline: "middle" });
    doc.setFillColor(255, 255, 255);
    doc.rect(px + lw, py, vw, h, "FD");
    const val = String(value || "").trim();
    fitValueFont(val, Math.max(3, vw - 1.5), boldVal);
    doc.setTextColor(...BODY_TEXT);
    doc.text(val, px + lw + 0.8, py + h / 2, { baseline: "middle" });
  };

  drawPair(innerX, y, "Unit No", unit.unit_no, labelW, valueW, rowH, true);
  drawPair(
    innerX + pairW,
    y,
    "Unit in",
    unit.unit_in || "",
    labelW,
    valueW,
    rowH
  );
  drawPair(
    innerX,
    y + rowH,
    "Priority",
    unit.priority === "—" ? "" : unit.priority,
    labelW,
    valueW,
    rowH
  );
  drawPair(
    innerX + pairW,
    y + rowH,
    "Est dt",
    unit.est_dt || "",
    labelW,
    valueW,
    rowH
  );

  const descY = y + rowH * 2;
  const descH = Math.max(5, height - rowH * 2);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(0, 0, 0);
  doc.rect(innerX, descY, innerW, descH, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...BODY_TEXT);
  const descLines = doc.splitTextToSize(
    String(unit.description || "").trim() || "—",
    innerW - 2
  );
  let ty = descY + 2.5;
  for (const line of descLines) {
    if (ty > descY + descH - 1) break;
    doc.text(line, innerX + 1, ty);
    ty += 3;
  }
}

function crewTableBlock(
  doc: JsPdfWithAutoTable,
  payload: HandoverFormPayload,
  y: number,
  margin: number,
  pageW: number
): number {
  const gap = 2.5;
  const totalW = pageW - margin * 2;
  // Hadir wide (dual lists), Other narrow, Next Crew remainder
  const currentW = totalW * 0.42;
  const otherW = totalW * 0.18;
  const nextW = totalW - currentW - otherW - gap * 2;
  const pad = 1.2;
  const y0 = y;

  const hadir = toHadirLines(payload.hadir);
  const other = toOtherLines(payload.sakit);
  const next = toNextLines(payload.next_crew);

  const currentCode =
    shiftShortCode(payload.current_shift_label) ||
    payload.current_shift_label ||
    "—";
  const nextCode =
    shiftShortCode(payload.next_shift_label) ||
    payload.next_shift_label ||
    "—";
  const dateLabel = formatHandoverDate(payload.date);
  const period = periodLabel(payload);

  const currentInner = currentW - pad * 2;
  const otherInner = otherW - pad * 2;
  const nextInner = nextW - pad * 2;

  const cx = margin;
  const ox = margin + currentW + gap;
  const nx = ox + otherW + gap;

  // --- Hadir: B | date | Night + dual #|Name|Hadir (reference image 2) ---
  const currentBottom = drawHadirPanel(
    doc,
    cx + pad,
    y0 + pad,
    currentInner,
    currentCode,
    dateLabel,
    period,
    hadir
  );

  // --- Other Status: header + #|Name|Sakit ---
  const otherBottom = drawOtherStatusPanel(
    doc,
    ox + pad,
    y0 + pad,
    otherInner,
    other
  );

  // --- Next Crew: reference newspaper (header left only, dual lists) ---
  const nextBottom = drawNextCrewPanel(
    doc,
    nx + pad,
    y0 + pad,
    nextInner,
    nextCode,
    next
  );

  const contentBottom = Math.max(
    currentBottom,
    otherBottom,
    nextBottom,
    y0 + 28
  );
  const boxH = contentBottom - y0 + pad;

  resetPdfColors(doc);
  doc.setDrawColor(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]);
  doc.setLineWidth(0.55);
  doc.rect(cx, y0, currentW, boxH, "S");
  doc.rect(ox, y0, otherW, boxH, "S");
  doc.rect(nx, y0, nextW, boxH, "S");
  resetPdfColors(doc);

  return y0 + boxH + 2;
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
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  let y = margin;

  // PNG is 400×104 (~3.85:1); keep that ratio so Trakindo|CAT isn't squashed.
  const LOGO_H = 7.2;
  const LOGO_W = LOGO_H * (400 / 104);
  const logo = tryLoadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, LOGO_W, LOGO_H);
    } catch {
      /* ignore */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...HEADER_TEXT);
  doc.text("HAND OVER FORM", pageW / 2, y + LOGO_H / 2 + 1, {
    align: "center",
  });
  doc.setTextColor(0, 0, 0);
  y += LOGO_H + 4;
  y = crewTableBlock(doc, payload, y, margin, pageW);

  // Reference image 2 header: (blank over unit block) | Progress | Prev M/P | Hand Over | Plan M/P
  const contentW = pageW - margin * 2;
  const unitColW = contentW * 0.28;
  const progressW = contentW * 0.24;
  const prevW = contentW * 0.14;
  const handW = contentW * 0.24;
  const planW = contentW - unitColW - progressW - prevW - handW;
  const units = payload.units;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["", "Progress", "Prev M/P", "Hand Over", "Plan M/P"]],
    body: units.length
      ? units.map((u) => [
          "", // Unit No / Unit in drawn in didDrawCell
          bullets(u.progress),
          bullets(u.prev_mp),
          bullets(u.handover),
          bullets(u.plan_mp),
        ])
      : [["Tidak ada job aktif", "", "", "", ""]],
    styles: {
      fontSize: 7,
      cellPadding: 1,
      overflow: "linebreak",
      valign: "top",
      textColor: BODY_TEXT,
      fillColor: [255, 255, 255],
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: HEADER_BLUE,
      textColor: BODY_TEXT,
      fontStyle: "bold",
      fontSize: 8,
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0],
      lineWidth: 0.35,
      minCellHeight: 6,
    },
    bodyStyles: {
      textColor: BODY_TEXT,
      fillColor: [255, 255, 255],
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: unitColW, cellPadding: 0.4 },
      1: { cellWidth: progressW },
      2: { cellWidth: prevW },
      3: { cellWidth: handW },
      4: { cellWidth: planW },
    },
    theme: "grid",
    didParseCell: (data) => {
      if (data.section === "head") {
        // Unit block: no header box — white, no top/side borders (reference)
        if (data.column.index === 0) {
          data.cell.styles.fillColor = [255, 255, 255];
          data.cell.styles.textColor = BODY_TEXT;
          data.cell.styles.lineWidth = {
            top: 0,
            left: 0,
            right: 0,
            bottom: 0.8,
          };
        } else {
          // Progress / Prev / Hand Over / Plan — blue header with full border
          data.cell.styles.lineWidth = {
            bottom: 0.8,
            top: 0.35,
            left: 0.35,
            right: 0.35,
          };
        }
      }
      if (data.section !== "body" || data.column.index !== 0) return;
      if (!units.length) return;
      const unit = units[data.row.index];
      if (!unit) return;
      data.cell.text = [];
      data.cell.styles.minCellHeight = estimateUnitCardHeight(
        doc,
        unit,
        unitColW
      );
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;
      if (!units.length) return;
      const unit = units[data.row.index];
      if (!unit) return;
      drawUnitCard(
        doc,
        data.cell.x,
        data.cell.y,
        data.cell.width,
        data.cell.height,
        unit,
        data.row.index + 1
      );
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(
      `Printed on: ${printedLabel(payload.printed_at)}`,
      margin,
      pageH - 5
    );
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 5, {
      align: "right",
    });
    doc.setTextColor(0);
  }

  const arrayBuf = doc.output("arraybuffer");
  const buffer = new Uint8Array(arrayBuf);
  const filename = `handover-form-${payload.date}_${fmtFileStamp()}.pdf`;
  return { buffer, filename, payload };
}
