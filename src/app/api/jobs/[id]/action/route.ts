import { NextResponse } from "next/server";
import { jobAction } from "@/lib/excel";

export const dynamic = "force-dynamic";

const ACTIONS = [
  "assign",
  "start",
  "pause",
  "resume",
  "complete_step",
  "complete",
  "cancel",
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
    const job = await jobAction(id, action, {
      technician_id: body.technician_id,
      technician_ids: Array.isArray(body.technician_ids)
        ? body.technician_ids.map(String)
        : undefined,
      note: body.note,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
