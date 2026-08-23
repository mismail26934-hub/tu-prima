import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("technician", "create");
  if (denied) return denied;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";

  const sheet = workbook.addWorksheet("Teknisi");
  sheet.columns = [
    { header: "Nama", key: "name", width: 28 },
    { header: "SN / Pernr", key: "sn", width: 18 },
    { header: "No. ID Badge", key: "badge_id", width: 18 },
    { header: "Email", key: "email", width: 28 },
    { header: "Telepon", key: "phone", width: 20 },
    { header: "Status", key: "status", width: 16 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:F1";
  sheet.getRow(1).font = { bold: true, color: { argb: "FF111827" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
  sheet.getColumn("B").numFmt = "@";
  sheet.getColumn("C").numFmt = "@";
  sheet.getColumn("D").numFmt = "@";
  sheet.getColumn("E").numFmt = "@";

  for (let row = 2; row <= 501; row += 1) {
    sheet.getCell(`F${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"available,offline"'],
      showErrorMessage: true,
      errorTitle: "Status tidak valid",
      error: "Pilih available atau offline.",
    };
  }

  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [
    { header: "Kolom", key: "column", width: 22 },
    { header: "Ketentuan", key: "rule", width: 72 },
  ];
  guide.addRows([
    { column: "Nama", rule: "Wajib. Nama lengkap teknisi. Alias: Nama Karyawan." },
    {
      column: "SN / Pernr",
      rule: "Wajib dan unik. Nomor Pernr untuk absensi/HR. Jika SN sudah ada, baris akan memperbarui teknisi tersebut.",
    },
    {
      column: "No. ID Badge",
      rule: "Wajib dan unik. Terpisah dari SN/Pernr. Alias: Badge ID, ID Badge.",
    },
    {
      column: "Email",
      rule: "Wajib dan unik. Format email valid (contoh: nama@perusahaan.com).",
    },
    {
      column: "Telepon",
      rule: "Wajib untuk teknisi baru. Gunakan format teks agar angka 0 di depan tidak hilang.",
    },
    {
      column: "Status",
      rule: "Opsional: available atau offline. Jika kosong, teknisi baru menjadi available.",
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
      "Content-Disposition":
        'attachment; filename="template-upload-teknisi.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
