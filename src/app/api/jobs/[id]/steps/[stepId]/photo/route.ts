import { NextResponse } from "next/server";
import { getJobById } from "@/lib/board-list";
import { requirePermission } from "@/lib/access";
import { readStepPhotoFile } from "@/lib/step-photo";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const denied = await requirePermission("job", "read");
  if (denied) return denied;
  try {
    const { id, stepId } = await ctx.params;
    const found = await getJobById(id);
    if (!found) {
      return NextResponse.json({ error: "Job tidak ditemukan" }, { status: 404 });
    }
    const step = found.job.steps.find((s) => s.id === stepId);
    if (!step) {
      return NextResponse.json({ error: "Step tidak ditemukan" }, { status: 404 });
    }
    const file = await readStepPhotoFile(step.id, step.photo_name || `${step.id}.jpg`);
    if (!file) {
      return NextResponse.json({ error: "Foto bukti belum ada" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${file.fileName}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat foto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
