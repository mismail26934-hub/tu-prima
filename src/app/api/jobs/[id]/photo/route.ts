import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import { lookupJobPhotoAccess, readListedJobPhoto } from "@/lib/job-photo";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission("job", "read");
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const photoId = String(url.searchParams.get("id") || "").trim();
    const size = url.searchParams.get("size") === "thumb" ? "thumb" : "full";
    const meta = await lookupJobPhotoAccess(id);
    if (!meta) {
      return NextResponse.json({ error: "Job tidak ditemukan" }, { status: 404 });
    }
    const listed = photoId
      ? meta.photos.find((p) => p.id === photoId)
      : meta.photos[0];
    if (!listed) {
      return NextResponse.json({ error: "Foto job belum ada" }, { status: 404 });
    }
    const file = await readListedJobPhoto(listed, size);
    if (!file) {
      return NextResponse.json({ error: "Foto job belum ada" }, { status: 404 });
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
