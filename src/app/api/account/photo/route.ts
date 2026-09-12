import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserById } from "@/lib/excel";
import { readUserPhotoFile } from "@/lib/user-photo";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Silakan login" }, { status: 401 });
  }
  try {
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
    }
    const file = await readUserPhotoFile(userId, user.photo_name);
    if (!file) {
      return NextResponse.json({ error: "Foto profil belum ada" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${file.fileName}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat foto profil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
