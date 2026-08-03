import { NextResponse } from "next/server";
import {
  deleteTechnician,
  setTechnicianStatus,
  updateTechnician,
} from "@/lib/excel";
import type { TechnicianStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    if (body.name != null || body.skill != null || body.phone != null) {
      if (!body.name || !body.skill || !body.phone) {
        return NextResponse.json(
          { error: "nama, SN KPC, dan telepon wajib diisi" },
          { status: 400 }
        );
      }
      const tech = await updateTechnician(id, {
        name: String(body.name),
        skill: String(body.skill),
        phone: String(body.phone),
        status:
          body.status === "available" || body.status === "offline"
            ? body.status
            : undefined,
      });
      return NextResponse.json(tech);
    }

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

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const result = await deleteTechnician(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
