import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/access";
import {
  lookupStepNoteFileAccess,
  readStepNotePdfFile,
} from "@/lib/step-note-file";

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
    const noteId = String(url.searchParams.get("noteId") || "").trim();
    if (!noteId) {
      return NextResponse.json({ error: "Catatan tidak ditemukan" }, { status: 404 });
    }
    const note = await lookupStepNoteFileAccess(id, stepId, noteId);
    if (!note) {
      return NextResponse.json({ error: "PDF catatan belum ada" }, { status: 404 });
    }
    const file = await readStepNotePdfFile(String(note.file_name || `${note.file_id}.pdf`));
    if (!file) {
      return NextResponse.json({ error: "PDF catatan belum ada" }, { status: 404 });
    }
    const download = String(note.file_original_name || file.fileName).replace(
      /[\r\n"]/g,
      ""
    );
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${download || "lampiran.pdf"}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat PDF";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
