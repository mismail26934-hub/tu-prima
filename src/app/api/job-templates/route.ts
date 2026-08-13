import { NextResponse } from "next/server";
import {
  createJobTemplate,
  getJobTemplate,
  listJobTemplates,
  listJobTemplatesFull,
} from "@/lib/job-templates";
import { requirePermission } from "@/lib/access";
import type { JobTemplateCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const includeInactive = searchParams.get("include_inactive") === "1";

  if (includeInactive) {
    const denied = await requirePermission("template", "read");
    if (denied) return denied;
  } else {
    const denied = await requirePermission("job", "read");
    if (denied) return denied;
  }

  if (id) {
    const template = getJobTemplate(id, { includeInactive });
    if (!template) {
      return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json(template);
  }

  const category = searchParams.get("category") as JobTemplateCategory | null;
  const valid =
    category === "engine" || category === "non_engine" || category === "goh"
      ? category
      : undefined;

  if (includeInactive) {
    return NextResponse.json({
      templates: listJobTemplatesFull(valid, { includeInactive: true }),
    });
  }

  if (searchParams.get("full") === "1") {
    return NextResponse.json({ templates: listJobTemplatesFull(valid) });
  }

  return NextResponse.json({ templates: listJobTemplates(valid) });
}

export async function POST(req: Request) {
  const denied = await requirePermission("template", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const template = createJobTemplate({
      id: body.id != null ? String(body.id) : undefined,
      category: body.category,
      name: String(body.name || ""),
      active: body.active != null ? String(body.active) : "1",
      steps: Array.isArray(body.steps) ? body.steps : [],
    });
    return NextResponse.json(template);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create template";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
