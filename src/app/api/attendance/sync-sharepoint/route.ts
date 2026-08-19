import { NextResponse } from "next/server";
import { syncTechnicianPresenceFromBuffer } from "@/lib/excel";
import { requirePermission } from "@/lib/access";
import {
  downloadSharePointExcelBuffer,
  getSharePointMealsConfig,
  isSharePointMealsSyncConfigured,
} from "@/lib/sharepoint/graph";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/sync-sharepoint
 * Meals Request (SharePoint) → compare No. ID Badge with technician SN.
 * - Badge ada di meals → available (+ attendance hadir)
 * - Badge tidak ada → offline
 * Busy technicians are left unchanged.
 *
 * Optional JSON: { "date": "YYYY-MM-DD" }
 * Optional multipart: file=.xlsx (local / Power Automate) — skips Graph if file present
 */
export async function POST(req: Request) {
  const denied = await requirePermission("attendance", "create");
  if (denied) return denied;
  const techDenied = await requirePermission("technician", "update");
  if (techDenied) return techDenied;

  try {
    let date = "";
    let buffer: Buffer | null = null;
    let fromUpload = false;

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      date = String(form.get("date") || "").trim();
      const file = form.get("file");
      if (file instanceof File) {
        const name = file.name.toLowerCase();
        if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
          return NextResponse.json(
            { error: "Format harus .xlsx" },
            { status: 400 }
          );
        }
        buffer = Buffer.from(await file.arrayBuffer());
        fromUpload = true;
      }
    } else if (ct.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as {
        date?: string;
      };
      date = String(body.date || "").trim();
    }

    if (!buffer) {
      if (!isSharePointMealsSyncConfigured()) {
        return NextResponse.json(
          {
            error:
              "SharePoint belum dikonfigurasi. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SHAREPOINT_MEALS_EXCEL_URL — atau upload file Meals Request (.xlsx).",
            configured: false,
          },
          { status: 503 }
        );
      }
      buffer = await downloadSharePointExcelBuffer(getSharePointMealsConfig()!);
    }

    const result = await syncTechnicianPresenceFromBuffer(buffer, {
      date: date || undefined,
    });

    return NextResponse.json({
      ...result,
      source: fromUpload ? "upload" : "sharepoint",
      match_key: "No. ID Badge = SN / Pernr",
      rule: "ada di meals → available; tidak ada → offline (busy di-skip)",
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Sync kehadiran SharePoint gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  const denied = await requirePermission("attendance", "read");
  if (denied) return denied;
  return NextResponse.json({
    configured: isSharePointMealsSyncConfigured(),
    match_key: "No. ID Badge = SN / Pernr",
    rule: "ada di meals → available; tidak ada → offline (busy di-skip)",
  });
}
