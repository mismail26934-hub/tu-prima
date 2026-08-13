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
      duration_sec:
        typeof body.duration_sec === "number" ? Number(body.duration_sec) : undefined,
      completed_at: body.completed_at ? String(body.completed_at) : undefined,
      started_at: body.started_at ? String(body.started_at) : undefined,
      paused_at: body.paused_at ? String(body.paused_at) : undefined,
      total_paused_sec:
        typeof body.total_paused_sec === "number"
          ? Number(body.total_paused_sec)
          : undefined,
      resumed_at: body.resumed_at ? String(body.resumed_at) : undefined,
      step_snapshots: Array.isArray(body.step_snapshots)
        ? body.step_snapshots.map(
            (row: { id?: string; duration_sec?: number; started_at?: string }) => ({
              id: String(row.id || ""),
              duration_sec: Number(row.duration_sec || 0),
              started_at: row.started_at != null ? String(row.started_at) : undefined,
            })
          )
        : undefined,
      actor,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
