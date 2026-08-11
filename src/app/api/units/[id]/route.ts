import { NextResponse } from "next/server";
import { deleteUnit, updateUnit } from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("unit", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    if (!body.code || !body.name || !body.serial_number) {
      return NextResponse.json(
        { error: "code, name, dan serial_number wajib diisi" },
        { status: 400 }
      );
    }
    const unit = await updateUnit(id, {
      code: String(body.code),
      name: String(body.name),
      serial_number: String(body.serial_number),
      active: body.active != null ? String(body.active) : undefined,
    });
    return NextResponse.json(unit);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("unit", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteUnit(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
