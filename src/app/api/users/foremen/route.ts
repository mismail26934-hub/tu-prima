import { NextResponse } from "next/server";
import { listForemanUsers } from "@/lib/excel";
import { getCurrentLevel } from "@/lib/access";
import { canAssignJob } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Active foreman accounts — for job delegation picker. */
export async function GET() {
  const level = await getCurrentLevel();
  if (!canAssignJob(level)) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk melakukan aksi ini" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Daftar foreman hanya untuk foreman / superuser" },
      { status: 403 }
    );
  }
  try {
    const users = await listForemanUsers();
    return NextResponse.json(users);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat foreman";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
