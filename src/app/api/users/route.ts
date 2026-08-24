import { NextResponse } from "next/server";
import { createUser, listUsers } from "@/lib/excel";
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

export async function GET() {
  const level = await getCurrentLevel();
  const denied = denyUnlessSuperuser(level);
  if (denied) return denied;
  try {
    const users = await listUsers();
    return NextResponse.json(users);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const level = await getCurrentLevel();
  const deniedSu = denyUnlessSuperuser(level);
  if (deniedSu) return deniedSu;
  const denied = await requirePermission("user", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "username dan password wajib diisi" },
        { status: 400 }
      );
    }
    const user = await createUser({
      username: String(body.username),
      password: String(body.password),
      name: body.name != null ? String(body.name) : undefined,
      email: body.email != null ? String(body.email) : undefined,
      phone: body.phone != null ? String(body.phone) : undefined,
      level: USER_LEVELS.includes(body.level as UserLevel)
        ? (body.level as UserLevel)
        : "teknisi",
      active: body.active === "0" ? "0" : "1",
    });
    return NextResponse.json(user);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
