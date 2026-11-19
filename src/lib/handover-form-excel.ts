import ExcelJS from "exceljs";
import {
  buildHandoverFormPayload,
  formatHandoverDate,
  type HandoverFormPayload,
} from "@/lib/handover-form-data";
import { fmtFileStamp } from "@/lib/file-stamp";

function bullets(lines: string[]): string {
  if (!lines.length) return "";
  return lines.map((l) => `• ${l}`).join("\n");
}

function unitBlock(row: HandoverFormPayload["units"][number]): string {
  const bits = [
    `Unit No: ${row.unit_no}`,
    `Priority: ${row.priority}`,
    `Unit in: ${row.unit_in || "—"}`,
    `Est dt: ${row.est_dt || "—"}`,
  ];
  if (row.customer) bits.push(`Customer: ${row.customer}`);
  if (row.smu) bits.push(`SMU: ${row.smu}`);
  bits.push(row.description || "");
  return bits.filter(Boolean).join("\n");
}

export async function buildHandoverFormExcelBuffer(date: string): Promise<{
  buffer: Buffer;
  filename: string;
  payload: HandoverFormPayload;
}> {
  const payload = await buildHandoverFormPayload(date);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TU-PRIMA";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Hand Over Form", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });

  sheet.mergeCells("A1:E1");
  const title = sheet.getCell("A1");
  title.value = "HAND OVER FORM - MACHINE SECTION";
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 24;

  sheet.mergeCells("A2:E2");
  sheet.getCell("A2").value =
    `Date: ${formatHandoverDate(payload.date)} · Printed: ${formatHandoverDate(payload.printed_at)}`;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF555555" } };

  const crewSheet = wb.addWorksheet("Crew");
  crewSheet.columns = [
    { header: "Section", key: "section", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Status / Ket", key: "ket", width: 24 },
  ];
  for (const r of payload.hadir) {
    crewSheet.addRow({ section: "Hadir", name: r.name, ket: r.note || r.status });
  }
  for (const r of payload.sakit) {
    crewSheet.addRow({
      section: "Sakit",
      name: r.name,
      ket: r.note || r.status,
    });
  }
  for (const r of payload.next_crew) {
    crewSheet.addRow({
      section: "Next Crew",
      name: r.name,
      ket: r.note || r.status,
    });
  }
  if (
    !payload.hadir.length &&
    !payload.sakit.length &&
    !payload.next_crew.length
  ) {
    crewSheet.addRow({ section: "—", name: "Tidak ada data absensi", ket: "" });
  }
  crewSheet.getRow(1).font = { bold: true };

  sheet.addRow([]);
  const header = sheet.addRow([
    "Unit",
    "Progress",
    "Prev M/P",
    "Hand Over",
    "Plan M/P",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E5AA0" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  sheet.columns = [
    { key: "unit", width: 32 },
    { key: "progress", width: 36 },
    { key: "prev", width: 22 },
    { key: "handover", width: 36 },
    { key: "plan", width: 22 },
  ];

  if (!payload.units.length) {
    const empty = sheet.addRow([
      "Tidak ada job aktif",
      "",
      "",
      "",
      "",
    ]);
    empty.alignment = { wrapText: true, vertical: "top" };
  } else {
    for (const u of payload.units) {
      const row = sheet.addRow([
        unitBlock(u),
        bullets(u.progress),
        bullets(u.prev_mp),
        bullets(u.handover),
        bullets(u.plan_mp),
      ]);
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = Math.max(
        40,
        14 *
          Math.max(
            unitBlock(u).split("\n").length,
            u.progress.length,
            u.handover.length,
            u.prev_mp.length,
            u.plan_mp.length,
            2
          )
      );
    }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `handover-form-${payload.date}_${fmtFileStamp()}.xlsx`;
  return { buffer, filename, payload };
}
