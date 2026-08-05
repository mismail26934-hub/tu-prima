import { NextResponse } from "next/server";
import { deleteAttendance, updateAttendance } from "@/lib/excel";
import type { AttendanceStatus } from "@/lib/types";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

const ALLOWED: AttendanceStatus[] = ["hadir", "izin", "sakit", "off", "alpha"];

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("attendance", "update");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const status = String(body.status || "") as AttendanceStatus;
    if (!body.date || !body.technician_name || !ALLOWED.includes(status)) {
      return NextResponse.json(
        { error: "tanggal, nama teknisi, dan status wajib diisi" },
        { status: 400 }
      );
    }
    const row = await updateAttendance(id, {
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
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("attendance", "delete");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const result = await deleteAttendance(id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
