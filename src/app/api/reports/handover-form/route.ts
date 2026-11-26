import { NextResponse } from "next/server";
import { getCurrentLevel } from "@/lib/access";
import { canAccess } from "@/lib/permissions";
import { buildHandoverFormExcelBuffer } from "@/lib/handover-form-excel";
import { buildHandoverFormPdfBuffer } from "@/lib/handover-form-pdf";
import {
  buildHandoverFormPayload,
  type HandoverFormPayloadOverrides,
} from "@/lib/handover-form-data";

export const dynamic = "force-dynamic";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function overridesFromSearchParams(
  searchParams: URLSearchParams
): HandoverFormPayloadOverrides {
  return {
    current_shift_label:
      String(searchParams.get("current_shift") || "").trim() || undefined,
    next_shift_label:
      String(searchParams.get("next_shift") || "").trim() || undefined,
    shift_period:
      String(searchParams.get("shift_period") || "").trim() || undefined,
  };
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
  const overrides = overridesFromSearchParams(searchParams);

  if (!isYmd(date)) {
    return NextResponse.json(
      { error: "Parameter date harus YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    if (format === "json") {
      const payload = await buildHandoverFormPayload(date, overrides);
      return NextResponse.json(payload);
    }
    if (format === "pdf") {
      const { buffer, filename } = await buildHandoverFormPdfBuffer(
        date,
        overrides
      );
      return new NextResponse(Buffer.from(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { buffer, filename } = await buildHandoverFormExcelBuffer(
      date,
      overrides
    );
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
