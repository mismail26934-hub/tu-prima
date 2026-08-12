import { NextResponse } from "next/server";
import {
  getJobTemplate,
  listJobTemplatesFull,
} from "@/lib/job-templates";
import { jobTemplatesToExcelBuffer } from "@/lib/job-template-excel";
import { requirePermission } from "@/lib/access";
import type { JobTemplateCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

function safeFilename(value: string): string {
  return String(value || "template")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

export async function GET(req: Request) {
  const denied = await requirePermission("template", "read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const category = searchParams.get("category") as JobTemplateCategory | null;
  const valid =
    category === "engine" || category === "non_engine" ? category : undefined;
  const includeInactive = searchParams.get("include_inactive") !== "0";

  const templates = id
    ? (() => {
        const one = getJobTemplate(id, { includeInactive: true });
        return one ? [one] : [];
      })()
    : listJobTemplatesFull(valid, { includeInactive });

  if (id && templates.length === 0) {
    return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
  }

  try {
    const buffer = await jobTemplatesToExcelBuffer(templates);
    const filename = id
      ? `job-template-${safeFilename(templates[0].id)}.xlsx`
      : valid
        ? `job-templates-${valid}.xlsx`
        : "job-templates.xlsx";
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
