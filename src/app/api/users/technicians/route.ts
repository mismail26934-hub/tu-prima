import { NextResponse } from "next/server";
import { listTechnicianCandidateUsers } from "@/lib/excel";
import { listShifts } from "@/lib/shifts";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Active teknisi accounts for Master Teknisi create picker. */
export async function GET(req: Request) {
  const denied = await requirePermission("technician", "create");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const includeLinked = searchParams.get("include_linked") !== "0";
    const [users, shifts] = await Promise.all([
      listTechnicianCandidateUsers({ includeLinked }),
      listShifts({ includeInactive: true }),
    ]);
    const shiftNameById = new Map(
      shifts.map((s) => [s.id, s.name] as const)
    );
    const enriched = users.map((u) => ({
      ...u,
      shift_name: shiftNameById.get(u.shift_id) || "",
    }));
    const available = enriched.filter((u) => !u.already_linked);
    return NextResponse.json({
      users: enriched,
      available_count: available.length,
      linked_count: enriched.length - available.length,
      total: enriched.length,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal memuat kandidat teknisi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
