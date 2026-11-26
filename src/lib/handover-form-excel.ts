import ExcelJS from "exceljs";
import {
  buildHandoverFormPayload,
  formatHandoverDate,
  otherStatusLabel,
  shiftShortCode,
  type HandoverFormPayload,
  type HandoverFormPayloadOverrides,
  type HandoverFormUnitRow,
} from "@/lib/handover-form-data";
import { fmtFileStamp } from "@/lib/file-stamp";

const HEADER_FILL = "FFA8C6E0";
const HEADER_FONT = "FF000000";
const BODY_FONT = "FF000000";
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF404040" } },
  left: { style: "thin", color: { argb: "FF404040" } },
  bottom: { style: "thin", color: { argb: "FF404040" } },
  right: { style: "thin", color: { argb: "FF404040" } },
};

function bullets(lines: string[]): string {
  if (!lines.length) return "";
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

function styleLabelCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 9, color: { argb: HEADER_FONT } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = THIN;
}

function styleValueCell(cell: ExcelJS.Cell, opts?: { bold?: boolean }) {
  cell.font = {
    size: 9,
    bold: Boolean(opts?.bold),
    color: { argb: BODY_FONT },
  };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = THIN;
}

const CREW_HEADER_FILL = "FFDCDCDC";

function styleHeaderCell(cell: ExcelJS.Cell, fillArgb = HEADER_FILL) {
  cell.font = { bold: true, size: 10, color: { argb: HEADER_FONT } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fillArgb },
  };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = THIN;
}

function styleCrewHeaderCell(cell: ExcelJS.Cell) {
  styleHeaderCell(cell, CREW_HEADER_FILL);
}

const CREW_PER_COL = 10;

type CrewLine = { no: number; name: string; col3: string };

function splitCrewColumns(rows: CrewLine[]): [CrewLine[], CrewLine[]] {
  if (rows.length <= CREW_PER_COL) return [rows, []];
  return [rows.slice(0, CREW_PER_COL), rows.slice(CREW_PER_COL)];
}

function writeCrewList(
  sheet: ExcelJS.Worksheet,
  startCol: number,
  startRow: number,
  rows: CrewLine[]
): number {
  rows.forEach((r, i) => {
    const rr = startRow + i;
    sheet.getCell(rr, startCol).value = r.no;
    styleValueCell(sheet.getCell(rr, startCol));
    sheet.getCell(rr, startCol).alignment = {
      vertical: "middle",
      horizontal: "center",
    };
    sheet.getCell(rr, startCol + 1).value = r.name;
    styleValueCell(sheet.getCell(rr, startCol + 1));
    sheet.getCell(rr, startCol + 2).value = r.col3;
    styleValueCell(sheet.getCell(rr, startCol + 2));
  });
  return startRow + Math.max(rows.length, 1);
}

/** Next Crew body: # | Name | Helper/SN | Ket(empty) — 4 cols like reference. */
function writeNextCrewList(
  sheet: ExcelJS.Worksheet,
  startCol: number,
  startRow: number,
  rows: CrewLine[]
): number {
  rows.forEach((r, i) => {
    const rr = startRow + i;
    sheet.getCell(rr, startCol).value = r.no;
    styleValueCell(sheet.getCell(rr, startCol));
    sheet.getCell(rr, startCol).alignment = {
      vertical: "middle",
      horizontal: "center",
    };
    sheet.getCell(rr, startCol + 1).value = r.name;
    styleValueCell(sheet.getCell(rr, startCol + 1));
    sheet.getCell(rr, startCol + 2).value = r.col3 || "Helper";
    styleValueCell(sheet.getCell(rr, startCol + 2));
    // Thick vertical between Name and Helper/SN
    sheet.getCell(rr, startCol + 2).border = {
      ...THIN,
      left: { style: "medium", color: { argb: "FF404040" } },
    };
    sheet.getCell(rr, startCol + 3).value = "";
    styleValueCell(sheet.getCell(rr, startCol + 3));
    if (i === 3 && rows.length > 4) {
      for (let c = startCol; c <= startCol + 3; c++) {
        sheet.getCell(rr, c).border = {
          ...sheet.getCell(rr, c).border,
          bottom: { style: "medium", color: { argb: "FF404040" } },
        };
      }
    }
  });
  return startRow + Math.max(rows.length, 1);
}

/** Newspaper crew layout: Current (2 cols) | Other Status | Next Crew (2 cols). */
function writeCrewNewspaper(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  payload: HandoverFormPayload
): number {
  const currentCode =
    shiftShortCode(payload.current_shift_label) ||
    payload.current_shift_label ||
    "—";
  const nextCode =
    shiftShortCode(payload.next_shift_label) ||
    payload.next_shift_label ||
    "—";
  const dateLabel = formatHandoverDate(payload.date);
  const periodRaw = String(payload.shift_period || "").trim();
  const periodBlob = `${payload.current_shift_label} ${payload.next_shift_label}`;
  const period =
    periodRaw ||
    (/night/i.test(periodBlob) ? "Night" : /day/i.test(periodBlob) ? "Day" : "");

  const hadir: CrewLine[] = payload.hadir.map((r, i) => ({
    no: i + 1,
    name: r.name,
    col3: "Hadir",
  }));
  const other: CrewLine[] = payload.sakit.map((r, i) => ({
    no: i + 1,
    name: r.name,
    col3: otherStatusLabel(r),
  }));
  const next: CrewLine[] = payload.next_crew.map((r, i) => ({
    no: i + 1,
    name: r.name,
    col3: String(r.sn || r.note || "").trim() || "Helper",
  }));

  // Header row — each cell sits directly above # | Name | Ket/Hadir/Status
  const h = startRow;
  const headTriple = (
    c0: number,
    a: string,
    b: string,
    c: string
  ) => {
    sheet.getCell(h, c0).value = a;
    styleCrewHeaderCell(sheet.getCell(h, c0));
    sheet.getCell(h, c0 + 1).value = b;
    styleCrewHeaderCell(sheet.getCell(h, c0 + 1));
    sheet.getCell(h, c0 + 2).value = c;
    styleCrewHeaderCell(sheet.getCell(h, c0 + 2));
  };

  // Hadir header like reference: B | date | Night (not "B · date · Hadir")
  headTriple(1, currentCode, dateLabel, period || "");
  // Second Hadir list (11+) has no header row — body only in cols 4–6

  // Other Status: single banner spanning #|Name|Status cols
  sheet.mergeCells(h, 8, h, 10);
  sheet.getCell(h, 8).value = "Other Status";
  styleCrewHeaderCell(sheet.getCell(h, 8));

  // Next Crew header (image 2): Next Crew: spans #|+Name | A | Ket
  sheet.mergeCells(h, 11, h, 12);
  sheet.getCell(h, 11).value = "Next Crew:";
  styleCrewHeaderCell(sheet.getCell(h, 11));
  sheet.getCell(h, 11).alignment = {
    vertical: "middle",
    horizontal: "left",
    wrapText: true,
  };
  sheet.getCell(h, 13).value = nextCode;
  styleCrewHeaderCell(sheet.getCell(h, 13));
  sheet.getCell(h, 14).value = "Ket";
  styleCrewHeaderCell(sheet.getCell(h, 14));

  const body = h + 1;
  const [hadirL, hadirR] = splitCrewColumns(hadir);
  const [nextL, nextR] = splitCrewColumns(next);

  const endHadirL = writeCrewList(
    sheet,
    1,
    body,
    hadirL.length ? hadirL : []
  );
  const endHadirR = hadirR.length ? writeCrewList(sheet, 4, body, hadirR) : body;
  const endOther = writeCrewList(sheet, 8, body, other);
  // 4-col lists: left 11–14, right 15–18 (no header on right)
  const endNextL = writeNextCrewList(
    sheet,
    11,
    body,
    nextL.length ? nextL : []
  );
  const endNextR = nextR.length
    ? writeNextCrewList(sheet, 15, body, nextR)
    : body;

  return Math.max(endHadirL, endHadirR, endOther, endNextL, endNextR, body) + 1;
}

/**
 * Unit card on A–P grid (same sheet as newspaper crew):
 *  [#] Unit No | val | Unit in | val | Progress | Prev | Hand Over | Plan
 *      Priority | val | Est dt  | val |  (right cols rowspan 3)
 *      description
 */
function writeUnitCard(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  index: number,
  unit: HandoverFormUnitRow
): number {
  const r1 = startRow;
  const r2 = startRow + 1;
  const r3 = startRow + 2;

  // A: index | B: label | C–D: val | E: label | F–G: val | H–J: Progress | K–L: Prev | M–N: HO | O–P: Plan
  sheet.mergeCells(r1, 1, r3, 1);
  const idx = sheet.getCell(r1, 1);
  idx.value = index;
  idx.font = { bold: true, size: 11 };
  idx.alignment = { vertical: "middle", horizontal: "center" };
  idx.border = THIN;

  const pair = (
    row: number,
    labelCol: number,
    valStart: number,
    valEnd: number,
    label: string,
    value: string,
    boldVal?: boolean
  ) => {
    sheet.getCell(row, labelCol).value = label;
    styleLabelCell(sheet.getCell(row, labelCol));
    if (valEnd > valStart) sheet.mergeCells(row, valStart, row, valEnd);
    sheet.getCell(row, valStart).value = value;
    styleValueCell(sheet.getCell(row, valStart), { bold: boldVal });
    for (let c = valStart; c <= valEnd; c++) {
      sheet.getCell(row, c).border = THIN;
    }
  };

  pair(r1, 2, 3, 4, "Unit No", unit.unit_no, true);
  pair(r1, 5, 6, 7, "Unit in", unit.unit_in || "");
  pair(r2, 2, 3, 4, "Priority", unit.priority === "—" ? "" : unit.priority);
  pair(r2, 5, 6, 7, "Est dt", unit.est_dt || "");

  sheet.mergeCells(r3, 2, r3, 7);
  const desc = sheet.getCell(r3, 2);
  desc.value = unit.description || "—";
  styleValueCell(desc);
  sheet.getRow(r3).height = Math.max(
    28,
    14 * Math.ceil(String(unit.description || "").length / 55)
  );

  const right: { start: number; end: number; text: string }[] = [
    { start: 8, end: 10, text: bullets(unit.progress) },
    { start: 11, end: 12, text: bullets(unit.prev_mp) },
    { start: 13, end: 14, text: bullets(unit.handover) },
    { start: 15, end: 16, text: bullets(unit.plan_mp) },
  ];
  for (const cell of right) {
    sheet.mergeCells(r1, cell.start, r3, cell.end);
    const c = sheet.getCell(r1, cell.start);
    c.value = cell.text;
    styleValueCell(c);
    for (let col = cell.start; col <= cell.end; col++) {
      sheet.getCell(r1, col).border = THIN;
      sheet.getCell(r2, col).border = THIN;
      sheet.getCell(r3, col).border = THIN;
    }
  }

  for (let c = 1; c <= 16; c++) {
    const cell = sheet.getCell(r3, c);
    cell.border = {
      ...THIN,
      bottom: { style: "medium", color: { argb: "FF000000" } },
    };
  }

  return r3 + 1;
}

export async function buildHandoverFormExcelBuffer(
  date: string,
  overrides?: HandoverFormPayloadOverrides | null
): Promise<{
  buffer: Buffer;
  filename: string;
  payload: HandoverFormPayload;
}> {
  const payload = await buildHandoverFormPayload(date, overrides);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TU-PRIMA";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Hand Over Form", {
    properties: { defaultRowHeight: 16 },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });

  // Wide grid: Next Crew uses 4+4 cols (K–R); unit cards reuse A–P below
  sheet.columns = [
    { key: "c1", width: 4 },
    { key: "c2", width: 14 },
    { key: "c3", width: 8 },
    { key: "c4", width: 4 },
    { key: "c5", width: 14 },
    { key: "c6", width: 8 },
    { key: "c7", width: 2 },
    { key: "c8", width: 4 },
    { key: "c9", width: 14 },
    { key: "c10", width: 8 },
    { key: "c11", width: 4 },
    { key: "c12", width: 16 },
    { key: "c13", width: 10 },
    { key: "c14", width: 8 },
    { key: "c15", width: 4 },
    { key: "c16", width: 16 },
    { key: "c17", width: 10 },
    { key: "c18", width: 8 },
  ];

  sheet.mergeCells("A1:R1");
  const title = sheet.getCell("A1");
  title.value = "HAND OVER FORM";
  title.font = { bold: true, size: 16, color: { argb: HEADER_FONT } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 26;

  sheet.mergeCells("A2:R2");
  sheet.getCell("A2").value =
    `Date: ${formatHandoverDate(payload.date)} · Printed on: ${printedLabel(payload.printed_at)}`;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF555555" } };

  let row = writeCrewNewspaper(sheet, 4, payload) + 1;

  // Column headers for machine section (A–P)
  // Reference image 2: blank over unit block | Progress | Prev M/P | Hand Over | Plan M/P
  const unitHeads: { start: number; end: number; label: string }[] = [
    { start: 1, end: 7, label: "" },
    { start: 8, end: 10, label: "Progress" },
    { start: 11, end: 12, label: "Prev M/P" },
    { start: 13, end: 14, label: "Hand Over" },
    { start: 15, end: 16, label: "Plan M/P" },
  ];
  const headerBoxBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "medium", color: { argb: "FF000000" } },
  };
  // Unit header area: no box — only thick bottom rule like reference
  const unitBlankBorder: Partial<ExcelJS.Borders> = {
    bottom: { style: "medium", color: { argb: "FF000000" } },
  };
  for (const h of unitHeads) {
    if (h.end > h.start) sheet.mergeCells(row, h.start, row, h.end);
    sheet.getCell(row, h.start).value = h.label;
    const isUnitBlank = !h.label;
    if (isUnitBlank) {
      sheet.getCell(row, h.start).font = { size: 10, color: { argb: BODY_FONT } };
      sheet.getCell(row, h.start).alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    } else {
      styleHeaderCell(sheet.getCell(row, h.start));
      sheet.getCell(row, h.start).font = {
        bold: true,
        size: 10,
        color: { argb: BODY_FONT },
      };
    }
    for (let c = h.start; c <= h.end; c++) {
      sheet.getCell(row, c).border = isUnitBlank
        ? unitBlankBorder
        : headerBoxBorder;
      sheet.getCell(row, c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isUnitBlank ? "FFFFFFFF" : HEADER_FILL },
      };
    }
  }
  row += 1;

  if (!payload.units.length) {
    sheet.mergeCells(row, 1, row, 18);
    const empty = sheet.getCell(row, 1);
    empty.value = "Tidak ada job aktif";
    styleValueCell(empty);
  } else {
    payload.units.forEach((u, i) => {
      row = writeUnitCard(sheet, row, i + 1, u) + 1;
    });
  }

  const currentCrewLabel = [
    shiftShortCode(payload.current_shift_label) ||
      payload.current_shift_label ||
      "Crew",
    formatHandoverDate(payload.date),
    String(payload.shift_period || "").trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const nextCrewLabel = shiftShortCode(payload.next_shift_label)
    ? `Next Crew: ${shiftShortCode(payload.next_shift_label)}`
    : "Next Crew";

  const crewSheet = wb.addWorksheet("Crew");
  crewSheet.columns = [
    { header: "Section", key: "section", width: 28 },
    { header: "No", key: "no", width: 5 },
    { header: "Name", key: "name", width: 28 },
    { header: "SN / Role", key: "sn", width: 14 },
    { header: "Status / Ket", key: "ket", width: 24 },
  ];
  payload.hadir.forEach((r, i) => {
    crewSheet.addRow({
      section: currentCrewLabel,
      no: i + 1,
      name: r.name,
      sn: r.sn || "",
      ket: r.note || r.status || "Hadir",
    });
  });
  payload.sakit.forEach((r, i) => {
    crewSheet.addRow({
      section: "Other Status",
      no: i + 1,
      name: r.name,
      sn: r.sn || "",
      ket: otherStatusLabel(r),
    });
  });
  payload.next_crew.forEach((r, i) => {
    crewSheet.addRow({
      section: nextCrewLabel,
      no: i + 1,
      name: r.name,
      sn: r.sn || "",
      ket: r.note || r.status || "",
    });
  });
  crewSheet.getRow(1).font = { bold: true };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `handover-form-${payload.date}_${fmtFileStamp()}.xlsx`;
  return { buffer, filename, payload };
}
