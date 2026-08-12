import { requirePermission } from "@/lib/access";
import { jobTemplateUploadTemplateBuffer } from "@/lib/job-template-excel";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("template", "read");
  if (denied) return denied;

  try {
    const buffer = await jobTemplateUploadTemplateBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="template-upload-job-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal membuat template Excel";
    return Response.json({ error: message }, { status: 500 });
  }
}
