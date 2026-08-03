import { NextResponse } from "next/server";
import { deleteJob, updateJob } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    if (!body.title || !body.unit) {
      return NextResponse.json(
        { error: "title dan unit wajib diisi" },
        { status: 400 }
      );
    }
    const job = await updateJob(id, {
      title: String(body.title),
      unit: String(body.unit),
      description: body.description ? String(body.description) : "",
      estimated_minutes: body.estimated_minutes
        ? Number(body.estimated_minutes)
        : 60,
      steps: Array.isArray(body.steps)
        ? body.steps.map(String).filter(Boolean)
        : undefined,
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
  try {
    const { id } = await ctx.params;
    const result = await deleteJob(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
