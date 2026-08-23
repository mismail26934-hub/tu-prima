import { NextResponse } from "next/server";
import { listTechniciansPaginated } from "@/lib/board-list";
import type { TechnicianStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseStatus(raw: string | null): "all" | TechnicianStatus {
  if (raw === "available" || raw === "busy" || raw === "offline") return raw;
  return "all";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("limit") || 10) || 10)
    );
    const q = url.searchParams.get("q") || "";
    const status = parseStatus(url.searchParams.get("status"));

    const result = await listTechniciansPaginated({ status, page, limit, q });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list technicians";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
