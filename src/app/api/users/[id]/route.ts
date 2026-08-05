import { NextResponse } from "next/server";
import { deleteUser, updateUser } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const user = await updateUser(id, {
      username: body.username != null ? String(body.username) : undefined,
      password: body.password != null ? String(body.password) : undefined,
      name: body.name != null ? String(body.name) : undefined,
      active:
        body.active === "0" || body.active === "1" ? body.active : undefined,
    });
    return NextResponse.json(user);
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
    const result = await deleteUser(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
