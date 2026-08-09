import { NextResponse } from "next/server";
import { listJobTemplates, getJobTemplate } from "@/lib/job-templates";
import { requirePermission } from "@/lib/access";
import type { JobTemplateCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requirePermission("job", "read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const template = getJobTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json(template);
  }

  const category = searchParams.get("category") as JobTemplateCategory | null;
  const valid =
    category === "engine" || category === "non_engine" ? category : undefined;
  return NextResponse.json({ templates: listJobTemplates(valid) });
}
