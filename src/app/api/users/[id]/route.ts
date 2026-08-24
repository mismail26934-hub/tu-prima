import { NextResponse } from "next/server";
import { deleteUser, updateUser } from "@/lib/excel";
import { getCurrentLevel, requirePermission } from "@/lib/access";
import { USER_LEVELS } from "@/lib/types";
import type { UserLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

function denyUnlessSuperuser(level: string) {
  if (level === "superuser") return null;
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk mengakses Master User" },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { error: "Master User hanya untuk superuser" },
    { status: 403 }
  );
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const level = await getCurrentLevel();
  const deniedSu = denyUnlessSuperuser(level);
  if (deniedSu) return deniedSu;
  const denied = await requirePermission("user", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const user = await updateUser(id, {
      username: body.username != null ? String(body.username) : undefined,
      password: body.password != null ? String(body.password) : undefined,
      name: body.name != null ? String(body.name) : undefined,
      email: body.email != null ? String(body.email) : undefined,
      phone: body.phone != null ? String(body.phone) : undefined,
      level: USER_LEVELS.includes(body.level as UserLevel)
        ? (body.level as UserLevel)
        : undefined,
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
  const level = await getCurrentLevel();
  const deniedSu = denyUnlessSuperuser(level);
  if (deniedSu) return deniedSu;
  const denied = await requirePermission("user", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteUser(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
