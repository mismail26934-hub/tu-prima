import { NextResponse } from "next/server";
import { deleteJobHandover, updateJobHandover } from "@/lib/excel";
import {
  getCurrentActor,
  requireHandoverWritePermission,
} from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; handoverId: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { handoverId } = await ctx.params;
    const body = await req.json();
    const actor = await getCurrentActor();
    const row = await updateJobHandover(handoverId, {
      title: body.title != null ? String(body.title) : undefined,
      note: body.note != null ? String(body.note) : undefined,
      done: typeof body.done === "boolean" ? body.done : undefined,
      actor,
    });
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal update handover";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; handoverId: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { handoverId } = await ctx.params;
    const actor = await getCurrentActor();
    const result = await deleteJobHandover(handoverId, actor);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal hapus handover";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
