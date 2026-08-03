import { NextResponse } from "next/server";
import { setTechnicianStatus } from "@/lib/excel";
import type { TechnicianStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const status = body.status as TechnicianStatus;
    if (!["available", "busy", "offline"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const tech = await setTechnicianStatus(id, status);
    return NextResponse.json(tech);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
