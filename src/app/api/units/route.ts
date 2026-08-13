import { NextResponse } from "next/server";
import { createUnit } from "@/lib/excel";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requirePermission("unit", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    if (!body.code || !body.name || !body.serial_number) {
      return NextResponse.json(
        { error: "code, name, dan serial_number wajib diisi" },
        { status: 400 }
      );
    }
    const unit = await createUnit({
      id: body.id ? String(body.id) : undefined,
      code: String(body.code),
      name: String(body.name),
      serial_number: String(body.serial_number),
    });
    return NextResponse.json(unit);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create unit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
