import { NextResponse } from "next/server";
import {
  parsePlanTechnicianIds,
  updateJobHandoverReport,
} from "@/lib/excel";
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
    const actor = await getCurrentActor();
    const progress_text =
      body.progress_text != null ? String(body.progress_text) : undefined;
    const handover_text =
      body.handover_text != null ? String(body.handover_text) : undefined;
    if (progress_text != null && !progress_text.trim()) {
      return NextResponse.json(
        { error: "Progress wajib diisi" },
        { status: 400 }
      );
    }
    if (handover_text != null && !handover_text.trim()) {
      return NextResponse.json(
        { error: "Hand Over wajib diisi" },
        { status: 400 }
      );
    }
    const job = await updateJobHandoverReport(id, {
      progress_text,
      handover_text,
      plan_technician_ids:
        body.plan_technician_ids != null
          ? parsePlanTechnicianIds(body.plan_technician_ids)
          : undefined,
      actor,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
