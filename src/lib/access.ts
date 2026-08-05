import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccess } from "@/lib/permissions";
import type {
  AccessAction,
  AccessLevel,
  AccessResource,
} from "@/lib/permissions";

export async function getCurrentLevel(): Promise<AccessLevel> {
  const session = await auth();
  return session?.user?.level || "guest";
}

export async function requirePermission(
  resource: AccessResource,
  action: AccessAction
): Promise<NextResponse | null> {
  const level = await getCurrentLevel();
  if (!canAccess(level, resource, action)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk melakukan aksi ini" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: `Akses ${action} ${resource} tidak diizinkan untuk level ${level}` },
      { status: 403 }
    );
  }
  return null;
}
