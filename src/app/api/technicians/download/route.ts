import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/access";
import { listTechniciansPaginated } from "@/lib/board-list";

export const dynamic = "force-dynamic";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const denied = await requirePermission("technician", "read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  try {
    const pageSize = 500;
    let page = 1;
    const all = [];
    for (;;) {
      const batch = await listTechniciansPaginated({
        status: "all",
        page,
        limit: pageSize,
        q,
      });
      all.push(...batch.items);
      if (page >= batch.totalPages || batch.items.length === 0) break;
      page += 1;
      if (page > 100) break;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TU-PRIMA";
    const sheet = workbook.addWorksheet("Teknisi");
    sheet.columns = [
      { header: "Nama", key: "name", width: 28 },
      { header: "SN / Pernr", key: "sn", width: 18 },
      { header: "No. ID Badge", key: "badge_id", width: 18 },
      { header: "Email", key: "email", width: 28 },
      { header: "Telepon", key: "phone", width: 18 },
      { header: "Status", key: "status", width: 12 },
      { header: "Shift", key: "shift_name", width: 18 },
      { header: "Superior", key: "superior_user_name", width: 22 },
      { header: "Login linked", key: "login_linked", width: 14 },
    ];
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 9 },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FF111827" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF59E0B" },
    };
    for (const col of ["B", "C", "D", "E"] as const) {
      sheet.getColumn(col).numFmt = "@";
    }

    for (const tech of all) {
      sheet.addRow({
        name: tech.name,
        sn: tech.sn,
        badge_id: tech.badge_id,
        email: tech.email,
        phone: tech.phone,
        status: tech.status,
        shift_name: tech.shift_name || "",
        superior_user_name: tech.superior_user_name || "",
        login_linked: tech.user_id ? "yes" : "no",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = q.trim()
      ? `teknisi-filtered-${todayStamp()}.xlsx`
      : `teknisi-${todayStamp()}.xlsx`;
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
