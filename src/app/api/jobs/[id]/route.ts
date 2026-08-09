import { NextResponse } from "next/server";
import { deleteJob, updateJob } from "@/lib/excel";
import { getCurrentActor, requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("job", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    if (!body.title || !body.unit_id) {
      return NextResponse.json(
        { error: "title dan unit wajib diisi" },
        { status: 400 }
      );
    }
    const actor = await getCurrentActor();
    const job = await updateJob(id, {
      title: String(body.title),
      unit_id: String(body.unit_id),
      description: body.description ? String(body.description) : "",
      estimated_minutes: body.estimated_minutes
        ? Number(body.estimated_minutes)
        : 60,
      steps: Array.isArray(body.steps)
        ? body.steps.map(String).filter(Boolean)
        : undefined,
      actor,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("job", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const actor = await getCurrentActor();
    const result = await deleteJob(id, actor);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
