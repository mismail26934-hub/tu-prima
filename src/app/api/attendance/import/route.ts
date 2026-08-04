import { NextResponse } from "next/server";
import { importAttendanceFromBuffer } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importAttendanceFromBuffer(buffer, { syncTechStatus });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
