import { NextResponse } from "next/server";
import { createJobPartLoan } from "@/lib/excel";
import {
  getCurrentActor,
  requireHandoverWritePermission,
} from "@/lib/access";
import type { PartLoanStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const actor = await getCurrentActor();
    const rawStatus = String(body.status || "open").toLowerCase();
    const status: PartLoanStatus =
      rawStatus === "closed" ? "closed" : "open";
    const row = await createJobPartLoan({
      job_id: id,
      part_name: String(body.part_name || ""),
      note: body.note != null ? String(body.note) : "",
      status,
      actor,
    });
    return NextResponse.json(row);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal buat peminjaman part";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
