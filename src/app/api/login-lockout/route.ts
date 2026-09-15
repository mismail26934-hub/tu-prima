import { NextResponse } from "next/server";
import { getLoginLockout } from "@/lib/login-lockout";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const username = new URL(req.url).searchParams.get("username") || "";
  return NextResponse.json(getLoginLockout(username));
}
