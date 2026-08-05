import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { changeOwnPassword } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Silakan login untuk mengubah password" },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: "Semua kolom password wajib diisi" },
        { status: 400 }
      );
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "Konfirmasi password baru tidak cocok" },
        { status: 400 }
      );
    }

    await changeOwnPassword(userId, currentPassword, newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal mengubah password";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
