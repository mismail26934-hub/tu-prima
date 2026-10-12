import { NextResponse } from "next/server";
import { deleteJobPriority, updateJobPriority } from "@/lib/job-priorities";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("priority", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const priority = await updateJobPriority(id, {
      name: body.name != null ? String(body.name) : undefined,
      sort_order:
        body.sort_order != null ? Number(body.sort_order) : undefined,
      active: body.active != null ? String(body.active) : undefined,
    });
    return NextResponse.json(priority);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("priority", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteJobPriority(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
