import { NextResponse } from "next/server";
import { createUnit } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.code || !body.name) {
      return NextResponse.json(
        { error: "code dan name wajib diisi" },
        { status: 400 }
      );
    }
    const unit = await createUnit({
      code: String(body.code),
      name: String(body.name),
    });
    return NextResponse.json(unit);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create unit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
