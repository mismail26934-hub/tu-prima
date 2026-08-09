import { NextResponse } from "next/server";
import { deleteJobPartLoan, updateJobPartLoan } from "@/lib/excel";
import {
  getCurrentActor,
  requireHandoverWritePermission,
} from "@/lib/access";
import type { PartLoanStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; loanId: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { loanId } = await ctx.params;
    const body = await req.json();
    const actor = await getCurrentActor();
    let status: PartLoanStatus | undefined;
    if (body.status != null) {
      const raw = String(body.status).toLowerCase();
      status = raw === "closed" ? "closed" : "open";
    }
    const row = await updateJobPartLoan(loanId, {
      part_name:
        body.part_name != null ? String(body.part_name) : undefined,
      note: body.note != null ? String(body.note) : undefined,
      status,
      actor,
    });
    return NextResponse.json(row);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal update peminjaman part";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; loanId: string }> }
) {
  const denied = await requireHandoverWritePermission();
  if (denied) return denied;
  try {
    const { loanId } = await ctx.params;
    const actor = await getCurrentActor();
    const result = await deleteJobPartLoan(loanId, actor);
    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal hapus peminjaman part";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
