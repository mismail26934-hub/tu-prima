import { NextResponse } from "next/server";
import { deleteCustomer, updateCustomer } from "@/lib/customers";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("customer", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const customer = await updateCustomer(id, {
      code: body.code != null ? String(body.code) : undefined,
      name: body.name != null ? String(body.name) : undefined,
      active: body.active != null ? String(body.active) : undefined,
    });
    return NextResponse.json(customer);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("customer", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteCustomer(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
