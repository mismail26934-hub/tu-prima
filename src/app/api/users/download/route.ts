import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentLevel } from "@/lib/access";
import { listUsers } from "@/lib/excel";
import { listShifts, shiftLabel } from "@/lib/shifts";

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

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const level = await getCurrentLevel();
  const denied = denyUnlessSuperuser(level);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  try {
    const [users, shifts] = await Promise.all([
      listUsers(),
      listShifts({ includeInactive: true }),
    ]);
    const shiftNameById = new Map(
      shifts.map((s) => [s.id, shiftLabel(s) || s.name || s.code])
    );

    const filtered = q
      ? users.filter((u) => {
          const shift = shiftNameById.get(u.shift_id) || "";
          const hay = [
            u.username,
            u.name,
            u.email,
            u.phone,
            u.level,
            shift,
            u.active === "1" ? "aktif" : "nonaktif",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : users;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TU-PRIMA";
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

    for (const u of filtered) {
      sheet.addRow({
        username: u.username,
        // Never export hashed passwords; blank = keep on re-import update
        password: "",
        name: u.name || "",
        email: u.email || "",
        phone: u.phone || "",
        level: u.level,
        shift: shiftNameById.get(u.shift_id) || "",
        active: u.active === "0" ? "nonaktif" : "aktif",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = q
      ? `users-filtered-${todayStamp()}.xlsx`
      : `users-${todayStamp()}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export gagal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
