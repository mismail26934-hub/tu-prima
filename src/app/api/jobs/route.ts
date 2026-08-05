import { NextResponse } from "next/server";
import { createJob } from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("job", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    if (!body.title || !body.unit_id) {
      return NextResponse.json(
        { error: "title dan unit wajib diisi" },
        { status: 400 }
      );
    }
    const job = await createJob({
      title: String(body.title),
      unit_id: String(body.unit_id),
      description: body.description ? String(body.description) : "",
      estimated_minutes: body.estimated_minutes
        ? Number(body.estimated_minutes)
        : 60,
      steps: Array.isArray(body.steps)
        ? body.steps.map(String).filter(Boolean)
        : undefined,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
