import { NextResponse } from "next/server";
import { listJobChangeBackups, undoJobChange } from "@/lib/excel";
import { getCurrentActor, getCurrentLevel } from "@/lib/access";

export const dynamic = "force-dynamic";

function denyUnlessSuperuser(level: string) {
  if (level === "superuser") return null;
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk mengakses Backup / Undo" },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { error: "Backup / Undo hanya untuk superuser" },
    { status: 403 }
  );
}

/** List recent change backups from data/backup-jobs.xlsx (superuser only). */
export async function GET(req: Request) {
  try {
    const level = await getCurrentLevel();
    const denied = denyUnlessSuperuser(level);
    if (denied) return denied;

    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 80);
    const jobId = url.searchParams.get("jobId") || undefined;
    const includeUndone = url.searchParams.get("includeUndone") === "1";

    const rows = await listJobChangeBackups({
      limit,
      jobId,
      includeUndone,
    });
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal load backup" },
      { status: 500 }
    );
  }
}

/** Undo one change (superuser only). */
export async function POST(req: Request) {
  try {
    const level = await getCurrentLevel();
    const denied = denyUnlessSuperuser(level);
    if (denied) return denied;

    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "id backup wajib" }, { status: 400 });
    }

    const actor = await getCurrentActor();
    const result = await undoJobChange(id, actor);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal undo" },
      { status: 400 }
    );
  }
}
