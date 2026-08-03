import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDashboard();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
