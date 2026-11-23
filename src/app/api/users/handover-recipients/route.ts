import { NextResponse } from "next/server";
import { listHandoverRecipientUsers } from "@/lib/excel";
import { getCurrentLevel } from "@/lib/access";
import { canAssignJob, canManageHandover } from "@/lib/permissions";
import { listShifts } from "@/lib/shifts";

export const dynamic = "force-dynamic";

/** Foreman + technician accounts — for handover "ditujukan kepada" (+ shift labels). */
export async function GET(req: Request) {
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
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get("include_inactive") === "1";
    const [users, shifts] = await Promise.all([
      listHandoverRecipientUsers({ includeInactive }),
      listShifts({ includeInactive: true }),
    ]);
    const shiftNameById = new Map(
      shifts.map((s) => [s.id, s.name || s.code || s.id] as const)
    );
    return NextResponse.json(
      users.map((u) => ({
        ...u,
        shift_name: shiftNameById.get(u.shift_id) || "",
      }))
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal memuat penerima handover";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
