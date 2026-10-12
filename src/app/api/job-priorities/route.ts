import { NextResponse } from "next/server";
import {
  createJobPriority,
  listJobPriorities,
} from "@/lib/job-priorities";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("include_inactive") === "1";

  if (includeInactive) {
    const denied = await requirePermission("priority", "read");
    if (denied) return denied;
  } else {
    const denied = await requirePermission("job", "read");
    if (denied) return denied;
  }

  return NextResponse.json({
    priorities: await listJobPriorities({ includeInactive }),
  });
}

export async function POST(req: Request) {
  const denied = await requirePermission("priority", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const priority = await createJobPriority({
      id: body.id ? String(body.id) : undefined,
      code: String(body.code || ""),
      name: String(body.name || ""),
      sort_order:
        body.sort_order != null ? Number(body.sort_order) : undefined,
      active: body.active != null ? String(body.active) : undefined,
    });
    return NextResponse.json(priority);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create priority";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
