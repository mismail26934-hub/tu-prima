import { NextResponse } from "next/server";
import { createJobHandover } from "@/lib/excel";
import {
  getCurrentActor,
  requireJobNotesWritePermission,
} from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requireJobNotesWritePermission();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const actor = await getCurrentActor();
    const plan_technician_ids = Array.isArray(body.plan_technician_ids)
      ? body.plan_technician_ids.map(String).filter(Boolean)
      : undefined;
    const next_crew_technician_ids = Array.isArray(
      body.next_crew_technician_ids
    )
      ? body.next_crew_technician_ids.map(String).filter(Boolean)
      : undefined;
    const row = await createJobHandover({
      id: body.id ? String(body.id) : undefined,
      job_id: id,
      title: body.title != null ? String(body.title) : "",
      shift_date: body.shift_date != null ? String(body.shift_date) : undefined,
      from_name: body.from_name != null ? String(body.from_name) : "",
      from_user_id: body.from_user_id != null ? String(body.from_user_id) : "",
      to_name: body.to_name != null ? String(body.to_name) : "",
      to_user_id: body.to_user_id != null ? String(body.to_user_id) : "",
      note: body.note != null ? String(body.note) : "",
      progress_text:
        body.progress_text != null ? String(body.progress_text) : undefined,
      handover_text:
        body.handover_text != null ? String(body.handover_text) : undefined,
      plan_technician_ids,
      next_crew_technician_ids,
      done: Boolean(body.done),
      actor,
    });
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal buat handover";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
