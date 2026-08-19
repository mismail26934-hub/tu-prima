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
 * @deprecated Use POST /api/attendance/sync-sharepoint
 * Kept for compatibility — runs presence sync (not master upsert).
 */
export async function POST(req: Request) {
  const denied = await requirePermission("technician", "update");
  if (denied) return denied;
  const attDenied = await requirePermission("attendance", "create");
  if (attDenied) return attDenied;

  if (!isSharePointMealsSyncConfigured()) {
    return NextResponse.json(
      {
        error:
          "SharePoint belum dikonfigurasi. Set AZURE_* dan SHAREPOINT_MEALS_EXCEL_URL. UI sync ada di Daftar Hadir (bukan Master Teknisi).",
        configured: false,
        moved_to: "/api/attendance/sync-sharepoint",
      },
      { status: 503 }
    );
  }

  try {
    let date = "";
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { date?: string };
      date = String(body.date || "").trim();
    }

    const buffer = await downloadSharePointExcelBuffer(
      getSharePointMealsConfig()!
    );
    const result = await syncTechnicianPresenceFromBuffer(buffer, {
      date: date || undefined,
    });

    return NextResponse.json({
      ...result,
      source: "sharepoint",
      match_key: "No. ID Badge = SN / Pernr",
      rule: "ada di meals → available; tidak ada → offline (busy di-skip)",
      deprecated_endpoint: true,
      moved_to: "/api/attendance/sync-sharepoint",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync SharePoint gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  const denied = await requirePermission("technician", "read");
  if (denied) return denied;
  return NextResponse.json({
    configured: isSharePointMealsSyncConfigured(),
    match_key: "No. ID Badge = SN / Pernr",
    rule: "ada di meals → available; tidak ada → offline",
    moved_to: "/api/attendance/sync-sharepoint",
  });
}
