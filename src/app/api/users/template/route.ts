import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentLevel } from "@/lib/access";
import { listShifts, shiftLabel } from "@/lib/shifts";
import { USER_LEVELS } from "@/lib/types";

export const dynamic = "force-dynamic";

function denyUnlessSuperuser(level: string) {
  if (level === "superuser") return null;
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk mengakses Master User" },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { error: "Master User hanya untuk superuser" },
    { status: 403 }
  );
}

export async function GET() {
  const level = await getCurrentLevel();
  const denied = denyUnlessSuperuser(level);
  if (denied) return denied;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";

  const shifts = await listShifts({ includeInactive: false });
  const shiftNames = shifts
    .map((s) => shiftLabel(s) || s.name || s.code)
    .map((n) => String(n || "").trim())
    .filter(Boolean);

  const sheet = workbook.addWorksheet("Users");
  sheet.columns = [
    { header: "Username", key: "username", width: 18 },
    { header: "Password", key: "password", width: 16 },
    { header: "Nama", key: "name", width: 24 },
    { header: "Email", key: "email", width: 28 },
    { header: "Telepon", key: "phone", width: 16 },
    { header: "Level", key: "level", width: 14 },
    { header: "Shift", key: "shift", width: 18 },
    { header: "Aktif", key: "active", width: 12 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 8 },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FF111827" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF59E0B" },
  };
  for (const col of ["A", "B", "C", "D", "E"] as const) {
    sheet.getColumn(col).numFmt = "@";
  }

  const levelList = USER_LEVELS.join(",");
  for (let row = 2; row <= 501; row += 1) {
    sheet.getCell(`F${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${levelList}"`],
      showErrorMessage: true,
      errorTitle: "Level tidak valid",
      error: `Pilih: ${levelList}`,
    };
    sheet.getCell(`H${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"aktif,nonaktif"'],
      showErrorMessage: true,
      errorTitle: "Status tidak valid",
      error: "Pilih aktif atau nonaktif.",
    };
    if (shiftNames.length) {
      const escaped = shiftNames.map((n) => n.replace(/"/g, '""')).join(",");
      if (escaped.length <= 240) {
        sheet.getCell(`G${row}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${escaped}"`],
          showErrorMessage: true,
          errorTitle: "Shift tidak valid",
          error: "Pilih shift dari Master Shift.",
        };
      }
    }
  }

  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [
    { header: "Kolom", key: "column", width: 18 },
    { header: "Ketentuan", key: "rule", width: 76 },
  ];
  guide.addRows([
    {
      column: "Username",
      rule: "Wajib dan unik. Jika username sudah ada, baris akan memperbarui user tersebut.",
    },
    {
      column: "Password",
      rule: "Wajib untuk user baru. Untuk update, kosongkan agar password lama tetap dipakai.",
    },
    { column: "Nama", rule: "Opsional. Default = Username." },
    { column: "Email", rule: "Opsional." },
    { column: "Telepon", rule: "Opsional. Simpan sebagai teks agar 0 di depan tidak hilang." },
    {
      column: "Level",
      rule: `Wajib untuk user baru. Nilai: ${USER_LEVELS.join(", ")}.`,
    },
    {
      column: "Shift",
      rule: shiftNames.length
        ? `Opsional. Nama/kode harus sama dengan Master Shift (contoh: ${shiftNames
            .slice(0, 5)
            .join(", ")}).`
        : "Opsional. Isi nama/kode dari Master Shift. (Belum ada shift aktif.)",
    },
    {
      column: "Aktif",
      rule: "Opsional: aktif/nonaktif atau 1/0. Default user baru = aktif.",
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
        'attachment; filename="template-upload-user.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
