import { NextResponse } from "next/server";
import {
  buildJobsReportBuffer,
  type JobReportScope,
} from "@/lib/job-excel-report";
import { getCurrentLevel } from "@/lib/access";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const level = await getCurrentLevel();
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk export laporan job" },
      { status: 401 }
    );
  }
  if (!canAccess(level, "job", "read")) {
    return NextResponse.json(
      { error: "Akses export laporan job tidak diizinkan" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const scopeRaw = String(searchParams.get("scope") || "").toLowerCase();
  if (scopeRaw !== "active" && scopeRaw !== "queue") {
    return NextResponse.json(
      { error: "Parameter scope wajib: active atau queue" },
      { status: 400 }
    );
  }
  const scope = scopeRaw as JobReportScope;

  try {
    const { buffer, filename } = await buildJobsReportBuffer(scope);
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Gagal membuat laporan Excel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
