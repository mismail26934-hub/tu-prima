import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import {
  lookupStepPhotoAccess,
  readListedStepPhoto,
  readStepPhotoFile,
} from "@/lib/step-photo";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const denied = await requirePermission("job", "read");
  if (denied) return denied;
  try {
    const { id, stepId } = await ctx.params;
    const url = new URL(req.url);
    const photoId = String(url.searchParams.get("id") || stepId).trim();
    const size = url.searchParams.get("size") === "thumb" ? "thumb" : "full";
    const meta = await lookupStepPhotoAccess(id, stepId);
    if (!meta) {
      return NextResponse.json({ error: "Step tidak ditemukan" }, { status: 404 });
    }
    const allowed =
      !meta.photos.length ||
      meta.photos.some((p) => p.id === photoId) ||
      photoId === stepId;
    if (!allowed) {
      return NextResponse.json({ error: "Foto bukti belum ada" }, { status: 404 });
    }
    const listed = meta.photos.find((p) => p.id === photoId);
    const file = listed
      ? await readListedStepPhoto(listed, size)
      : await readStepPhotoFile(stepId, photoId, size);
    if (!file) {
      return NextResponse.json({ error: "Foto bukti belum ada" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes.length),
        "Cache-Control":
          size === "thumb"
            ? "private, max-age=86400"
            : "private, max-age=3600",
        "Content-Disposition": `inline; filename="${file.fileName}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat foto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
