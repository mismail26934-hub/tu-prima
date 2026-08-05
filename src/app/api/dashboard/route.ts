import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/excel";
import { getCurrentLevel, requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("job", "read");
  if (denied) return denied;
  try {
    const data = await getDashboard();
    const level = await getCurrentLevel();
    if (level === "teknisi" || level === "guest") {
      data.units = [];
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
