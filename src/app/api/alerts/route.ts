import { NextResponse } from "next/server";
import { fetchNavAlerts } from "@/lib/board-list";
import { auth } from "@/auth";
import { EMPTY_NAV_ALERTS } from "@/lib/nav-alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Silakan login" },
      { status: 401 }
    );
  }
  const level = session.user.level;
  if (level !== "foreman" && level !== "teknisi") {
    return NextResponse.json(EMPTY_NAV_ALERTS);
  }
  try {
    const data = await fetchNavAlerts();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat alert";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
