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
      from_name: body.from_name != null ? String(body.from_name) : "",
      from_user_id: body.from_user_id != null ? String(body.from_user_id) : "",
      to_name: body.to_name != null ? String(body.to_name) : "",
      to_user_id: body.to_user_id != null ? String(body.to_user_id) : "",
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
