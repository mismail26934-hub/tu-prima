import { NextResponse } from "next/server";
import { getCurrentLevel } from "@/lib/access";
import { canAccess } from "@/lib/permissions";
import { buildHandoverFormExcelBuffer } from "@/lib/handover-form-excel";
import { buildHandoverFormPdfBuffer } from "@/lib/handover-form-pdf";
import { buildHandoverFormPayload } from "@/lib/handover-form-data";

export const dynamic = "force-dynamic";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: Request) {
  const level = await getCurrentLevel();
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk export Hand Over Form" },
      { status: 401 }
    );
  }
  if (!canAccess(level, "job", "read")) {
    return NextResponse.json(
      { error: "Akses export Hand Over Form tidak diizinkan" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const date =
    String(searchParams.get("date") || "").trim() ||
    new Date().toISOString().slice(0, 10);
  const format = String(searchParams.get("format") || "xlsx").toLowerCase();

  if (!isYmd(date)) {
    return NextResponse.json(
      { error: "Parameter date harus YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    if (format === "json") {
      const payload = await buildHandoverFormPayload(date);
      return NextResponse.json(payload);
    }
    if (format === "pdf") {
      const { buffer, filename } = await buildHandoverFormPdfBuffer(date);
      return new NextResponse(Buffer.from(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { buffer, filename } = await buildHandoverFormExcelBuffer(date);
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
      e instanceof Error ? e.message : "Gagal membuat Hand Over Form";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
