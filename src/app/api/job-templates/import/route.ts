import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import {
  commitJobTemplatesImport,
  previewJobTemplatesFromBuffer,
  type JobTemplateImportCommitRow,
} from "@/lib/job-template-excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("template", "create");
  if (denied) return denied;

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        rows?: JobTemplateImportCommitRow[];
      };
      const result = commitJobTemplatesImport(
        Array.isArray(body.rows) ? body.rows : []
      );
      return NextResponse.json(result);
    }

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
    const result = await previewJobTemplatesFromBuffer(buffer);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Import template gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
