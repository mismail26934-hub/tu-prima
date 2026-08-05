import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("unit", "create");
  if (denied) return denied;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";

  const sheet = workbook.addWorksheet("Unit");
  sheet.columns = [
    { header: "Nomor unit", key: "code", width: 20 },
    { header: "Model", key: "name", width: 28 },
    { header: "Status", key: "status", width: 16 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:C1";
  sheet.getRow(1).font = { bold: true, color: { argb: "FF111827" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
  sheet.getColumn("A").numFmt = "@";

  for (let row = 2; row <= 501; row += 1) {
    sheet.getCell(`C${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"aktif,nonaktif"'],
      showErrorMessage: true,
      errorTitle: "Status tidak valid",
      error: "Pilih aktif atau nonaktif.",
    };
  }

  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [
    { header: "Kolom", key: "column", width: 20 },
    { header: "Ketentuan", key: "rule", width: 72 },
  ];
  guide.addRows([
    {
      column: "Nomor unit",
      rule: "Wajib dan unik. Jika sudah ada, data unit tersebut akan diperbarui.",
    },
    { column: "Model", rule: "Wajib. Model atau tipe unit." },
    {
      column: "Status",
      rule: "Opsional: aktif atau nonaktif. Jika kosong, unit baru menjadi aktif.",
    },
  ]);
  guide.getRow(1).font = { bold: true };
  guide.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
  guide.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-upload-unit.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
