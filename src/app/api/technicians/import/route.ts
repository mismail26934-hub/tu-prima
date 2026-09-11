import { NextResponse } from "next/server";
import {
  commitTechniciansImport,
  previewTechniciansFromBuffer,
  type TechnicianImportCommitRow,
} from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("technician", "create");
  if (denied) return denied;

  const contentType = req.headers.get("content-type") || "";

  try {
    // Commit selected rows from preview modal
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        rows?: TechnicianImportCommitRow[];
      };
      const result = await commitTechniciansImport(
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
    const result = await previewTechniciansFromBuffer(buffer);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
