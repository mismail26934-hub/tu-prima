import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import {
  commitUnitsImport,
  previewUnitsFromBuffer,
  type UnitImportCommitRow,
} from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("unit", "create");
  if (denied) return denied;

  const contentType = req.headers.get("content-type") || "";

  try {
    // Commit selected rows from preview modal
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        rows?: UnitImportCommitRow[];
      };
      const result = await commitUnitsImport(
        Array.isArray(body.rows) ? body.rows : []
      );
      return NextResponse.json(result);
    }

    // Upload Excel → preview only (no DB write)
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
    const result = await previewUnitsFromBuffer(buffer);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import unit gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
