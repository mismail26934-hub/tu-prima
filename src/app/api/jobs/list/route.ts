import { NextResponse } from "next/server";
import { listJobsPaginated, type JobListSection, type JobOwnershipFilter } from "@/lib/board-list";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function parseSection(raw: string | null): JobListSection | null {
  if (raw === "active" || raw === "queue" || raw === "done" || raw === "cancelled") {
    return raw;
  }
  return null;
}

function parseOwnership(raw: string | null): JobOwnershipFilter {
  if (raw === "mine" || raw === "delegated") return raw;
  return "all";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const section = parseSection(url.searchParams.get("section"));
    if (!section) {
      return NextResponse.json(
        { error: "Query section wajib: active | queue | done | cancelled" },
        { status: 400 }
      );
    }
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || 5) || 5)
    );
    const q = url.searchParams.get("q") || "";
    const ownership = parseOwnership(url.searchParams.get("ownership"));
    const cursor = url.searchParams.get("cursor");
    const session = await auth();
    const userId = session?.user?.id ? String(session.user.id) : "";

    const result = await listJobsPaginated({
      section,
      page,
      limit,
      q,
      ownership,
      userId,
      cursor: cursor || null,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
