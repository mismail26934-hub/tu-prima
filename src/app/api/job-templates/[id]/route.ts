import { NextResponse } from "next/server";
import {
  deleteJobTemplate,
  updateJobTemplate,
} from "@/lib/job-templates";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("template", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const template = updateJobTemplate(id, {
      category: body.category,
      name: String(body.name || ""),
      active: body.active != null ? String(body.active) : undefined,
      steps: Array.isArray(body.steps) ? body.steps : [],
    });
    return NextResponse.json(template);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("template", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = deleteJobTemplate(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
