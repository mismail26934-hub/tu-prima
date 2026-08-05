import { NextResponse } from "next/server";
import { importAttendanceFromBuffer } from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("attendance", "create");
  if (denied) return denied;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "File Excel (.xlsx) wajib diunggah" },
        { status: 400 }
      );
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Format harus .xlsx" },
        { status: 400 }
      );
    }
    const syncTechStatus =
      String(form.get("sync_tech_status") || "") === "1" ||
      String(form.get("sync_tech_status") || "") === "true";
    if (syncTechStatus) {
      const techDenied = await requirePermission("technician", "update");
      if (techDenied) return techDenied;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importAttendanceFromBuffer(buffer, { syncTechStatus });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
