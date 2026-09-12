import { NextResponse } from "next/server";
import { listHandoverRecipientUsers } from "@/lib/excel";
import { getCurrentLevel } from "@/lib/access";
import { canAssignJob, canManageHandover } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Active foreman + technician accounts — for handover "ditujukan kepada". */
export async function GET() {
  const level = await getCurrentLevel();
  if (
    !canAssignJob(level) &&
    !canManageHandover(level) &&
    level !== "teknisi"
  ) {
    if (level === "guest") {
      return NextResponse.json(
        { error: "Silakan login untuk melakukan aksi ini" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Daftar penerima handover hanya untuk foreman / teknisi / superuser" },
      { status: 403 }
    );
  }
  try {
    const users = await listHandoverRecipientUsers();
    return NextResponse.json(users);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal memuat penerima handover";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
