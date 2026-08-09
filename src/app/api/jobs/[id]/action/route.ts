import { NextResponse } from "next/server";
import { jobAction } from "@/lib/excel";
import {
  getCurrentActor,
  requireAssignPermission,
  requireJobProgressPermission,
  requirePermission,
  requireReopenPermission,
} from "@/lib/access";

export const dynamic = "force-dynamic";

const ACTIONS = [
  "assign",
  "start",
  "pause",
  "resume",
  "start_step",
  "start_steps",
  "complete_step",
  "complete",
  "cancel",
  "reopen",
] as const;

type Action = (typeof ACTIONS)[number];

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    let denied;
    if (action === "assign") {
      denied = await requireAssignPermission();
    } else if (action === "reopen") {
      denied = await requireReopenPermission();
    } else if (
      [
        "start",
        "pause",
        "resume",
        "start_step",
        "start_steps",
        "complete_step",
        "complete",
      ].includes(action)
    ) {
      denied = await requireJobProgressPermission();
    } else {
      denied = await requirePermission("job", "update");
    }
    if (denied) return denied;

    const actor = await getCurrentActor();
    const job = await jobAction(id, action, {
      technician_id: body.technician_id,
      technician_ids: Array.isArray(body.technician_ids)
        ? body.technician_ids.map(String)
        : undefined,
      step_id: body.step_id ? String(body.step_id) : undefined,
      step_ids: Array.isArray(body.step_ids)
        ? body.step_ids.map(String)
        : undefined,
      step_mode:
        body.step_mode === "parallel" || body.step_mode === "sequential"
          ? body.step_mode
          : undefined,
      auto_start_first:
        typeof body.auto_start_first === "boolean"
          ? body.auto_start_first
          : undefined,
      auto_next:
        typeof body.auto_next === "boolean" ? body.auto_next : undefined,
      note: body.note,
      actor,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
