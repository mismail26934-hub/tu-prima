import { NextResponse } from "next/server";
import {
  deleteTechnician,
  setTechnicianStatus,
  updateTechnician,
} from "@/lib/excel";
import type { TechnicianStatus } from "@/lib/types";
import { requirePermission, getCurrentLevel, requireTechnicianPresencePermission } from "@/lib/access";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    if (
      body.name != null ||
      body.sn != null ||
      body.skill != null ||
      body.badge_id != null ||
      body.email != null ||
      body.phone != null
    ) {
      const denied = await requirePermission("technician", "update");
      if (denied) return denied;
      const sn = body.sn ?? body.skill;
      if (!body.name || !sn || !body.badge_id || !body.email || !body.phone) {
        return NextResponse.json(
          {
            error:
              "nama, SN/Pernr, Badge ID, email, dan telepon wajib diisi",
          },
          { status: 400 }
        );
      }
      const tech = await updateTechnician(id, {
        name: String(body.name),
        sn: String(sn),
        badge_id: String(body.badge_id),
        email: String(body.email),
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
    const level = await getCurrentLevel();
    const hasFullTechUpdate = canAccess(level, "technician", "update");
    if (!hasFullTechUpdate) {
      const denied = await requireTechnicianPresencePermission();
      if (denied) return denied;
      if (status === "busy") {
        return NextResponse.json(
          { error: "Foreman hanya boleh set available atau offline" },
          { status: 403 }
        );
      }
    } else {
      const denied = await requirePermission("technician", "update");
      if (denied) return denied;
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
  const denied = await requirePermission("technician", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteTechnician(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
