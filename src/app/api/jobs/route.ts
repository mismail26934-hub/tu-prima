import { NextResponse } from "next/server";
import { createJob } from "@/lib/excel";
import { getCurrentActor, requirePermission } from "@/lib/access";

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
    const actor = await getCurrentActor();
    const job = await createJob({
      id: body.id ? String(body.id) : undefined,
      title: String(body.title),
      unit_id: String(body.unit_id),
      description: body.description ? String(body.description) : "",
      estimated_minutes: body.estimated_minutes
        ? Number(body.estimated_minutes)
        : 60,
      steps: Array.isArray(body.steps)
        ? body.steps.map((step: unknown) => {
            if (typeof step === "string") return step;
            if (step && typeof step === "object" && "name" in step) {
              const row = step as { id?: string; name: string; std_minutes?: number };
              return {
                id: row.id ? String(row.id) : undefined,
                name: String(row.name),
                std_minutes: Number(row.std_minutes || 0) || 0,
              };
            }
            return "";
          }).filter((step: string | { name: string }) =>
            typeof step === "string" ? Boolean(step) : Boolean(step.name)
          )
        : undefined,
      template_id: body.template_id ? String(body.template_id) : undefined,
      actor,
    });
    return NextResponse.json(job);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
