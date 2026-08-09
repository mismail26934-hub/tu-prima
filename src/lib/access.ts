import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  canAccess,
  canAssignJob,
  canManageHandover,
  canManageJobProgress,
  canReopenJob,
} from "@/lib/permissions";
import type {
  AccessAction,
  AccessLevel,
  AccessResource,
} from "@/lib/permissions";
import type { AuditActor } from "@/lib/types";

export async function getCurrentLevel(): Promise<AccessLevel> {
  const session = await auth();
  return session?.user?.level || "guest";
}

/** Actor for audit / JobEvents — null if not logged in. */
export async function getCurrentActor(): Promise<AuditActor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    user_id: String(session.user.id),
    user_name: String(
      session.user.name || session.user.email || session.user.id
    ),
    user_level: String(session.user.level || "guest"),
  };
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

export async function requireAssignPermission(): Promise<NextResponse | null> {
  const level = await getCurrentLevel();
  if (!canAssignJob(level)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk melakukan aksi ini" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        error: `Assign teknisi hanya untuk level superuser dan foreman (level Anda: ${level})`,
      },
      { status: 403 }
    );
  }
  return null;
}

export async function requireJobProgressPermission(): Promise<NextResponse | null> {
  const level = await getCurrentLevel();
  if (!canManageJobProgress(level)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk melakukan aksi ini" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        error: `Start/pause/resume/selesaikan job hanya untuk level superuser dan foreman (level Anda: ${level})`,
      },
      { status: 403 }
    );
  }
  return null;
}

/** Catatan handover add/update/delete: hanya foreman. */
export async function requireHandoverWritePermission(): Promise<NextResponse | null> {
  const level = await getCurrentLevel();
  if (!canManageHandover(level)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk menambah/ubah catatan handover" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        error: `Tambah/ubah/hapus catatan handover hanya untuk level foreman (level Anda: ${level})`,
      },
      { status: 403 }
    );
  }
  return null;
}

/** Buka kembali job done: hanya superuser. */
export async function requireReopenPermission(): Promise<NextResponse | null> {
  const level = await getCurrentLevel();
  if (!canReopenJob(level)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk membuka kembali job" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        error: `Buka kembali job hanya untuk level superuser (level Anda: ${level})`,
      },
      { status: 403 }
    );
  }
  return null;
}
