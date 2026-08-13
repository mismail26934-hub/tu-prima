import { NextResponse } from "next/server";
import { createJobHandover } from "@/lib/excel";
import {
  getCurrentActor,
  requireHandoverWritePermission,
} from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const actor = await getCurrentActor();
    const row = await createJobHandover({
      id: body.id ? String(body.id) : undefined,
      job_id: id,
      title: String(body.title || ""),
      note: body.note != null ? String(body.note) : "",
      done: Boolean(body.done),
      actor,
    });
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal buat handover";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
