import { NextResponse } from "next/server";
import { createUser, listUsers } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const users = await listUsers();
    return NextResponse.json(users);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "username dan password wajib diisi" },
        { status: 400 }
      );
    }
    const user = await createUser({
      username: String(body.username),
      password: String(body.password),
      name: body.name != null ? String(body.name) : undefined,
      active: body.active === "0" ? "0" : "1",
    });
    return NextResponse.json(user);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
