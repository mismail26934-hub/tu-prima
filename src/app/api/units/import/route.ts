import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import { importUnitsFromBuffer } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("unit", "create");
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importUnitsFromBuffer(buffer);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import unit gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
