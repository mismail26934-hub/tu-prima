import { NextResponse } from "next/server";
import {
  buildJobsReportBuffer,
  type JobReportDateField,
  type JobReportScope,
} from "@/lib/job-excel-report";
import { getCurrentLevel } from "@/lib/access";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function parseDateField(raw: string): JobReportDateField {
  const v = raw.toLowerCase();
  if (v === "started" || v === "start") return "started";
  if (v === "completed" || v === "end" || v === "ended") return "completed";
  return "created";
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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
  const dateField = parseDateField(
    String(searchParams.get("dateField") || "created")
  );
  const dateFrom = String(searchParams.get("from") || "").trim();
  const dateTo = String(searchParams.get("to") || "").trim();

  if (dateFrom && !isYmd(dateFrom)) {
    return NextResponse.json(
      { error: "Parameter from harus YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (dateTo && !isYmd(dateTo)) {
    return NextResponse.json(
      { error: "Parameter to harus YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json(
      { error: "Tanggal from tidak boleh lebih besar dari to" },
      { status: 400 }
    );
  }

  try {
    const { buffer, filename } = await buildJobsReportBuffer(scope, {
      dateField,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
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
