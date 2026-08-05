import { NextResponse } from "next/server";
import { createAttendance, getDashboard } from "@/lib/excel";
import type { AttendanceStatus } from "@/lib/types";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED: AttendanceStatus[] = ["hadir", "izin", "sakit", "off", "alpha"];

export async function GET(req: Request) {
  const denied = await requirePermission("attendance", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date")?.trim() || "";
    const data = await getDashboard();
    const attendance = date
      ? data.attendance.filter((a) => a.date === date)
      : data.attendance;
    return NextResponse.json({ attendance });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load attendance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requirePermission("attendance", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const status = String(body.status || "") as AttendanceStatus;
    if (!body.date || !body.technician_name || !ALLOWED.includes(status)) {
      return NextResponse.json(
        { error: "tanggal, nama teknisi, dan status wajib diisi" },
        { status: 400 }
      );
    }
    const row = await createAttendance({
      date: String(body.date),
      technician_id: body.technician_id ? String(body.technician_id) : "",
      technician_name: String(body.technician_name),
      pernr: body.pernr != null ? String(body.pernr) : "",
      status,
      dws: body.dws != null ? String(body.dws) : "",
      check_in: body.check_in != null ? String(body.check_in) : "",
      check_out: body.check_out != null ? String(body.check_out) : "",
      absence: body.absence != null ? String(body.absence) : "",
      note: body.note != null ? String(body.note) : "",
    });
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create attendance";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
