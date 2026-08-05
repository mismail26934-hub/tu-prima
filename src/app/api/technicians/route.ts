import { NextResponse } from "next/server";
import { createTechnician } from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("technician", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    if (!body.name || !body.skill || !body.phone) {
      return NextResponse.json(
        { error: "nama, SN KPC, dan telepon wajib diisi" },
        { status: 400 }
      );
    }
    const tech = await createTechnician({
      name: String(body.name),
      skill: String(body.skill),
      phone: String(body.phone),
      status: body.status === "offline" ? "offline" : "available",
    });
    return NextResponse.json(tech);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create technician";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
