import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserById, updateOwnProfile } from "@/lib/excel";

export const dynamic = "force-dynamic";

async function requireUserId(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      error: NextResponse.json(
        { error: "Silakan login untuk mengubah profil" },
        { status: 401 }
      ),
    };
  }
  return { userId };
}

export async function GET() {
  const gate = await requireUserId();
  if ("error" in gate) return gate.error;
  try {
    const user = await getUserById(gate.userId);
    if (!user) {
      return NextResponse.json(
        { error: "User tidak ditemukan atau sudah nonaktif" },
        { status: 404 }
      );
    }
    return NextResponse.json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal memuat profil";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireUserId();
  if ("error" in gate) return gate.error;

  try {
    const body = await req.json();
    const user = await updateOwnProfile(gate.userId, {
      name: body.name != null ? String(body.name) : undefined,
      email: body.email != null ? String(body.email) : undefined,
      phone: body.phone != null ? String(body.phone) : undefined,
      photo_base64:
        body.photo_base64 != null ? String(body.photo_base64) : undefined,
      photo_mime: body.photo_mime != null ? String(body.photo_mime) : undefined,
      remove_photo: body.remove_photo === true,
    });
    return NextResponse.json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal mengubah profil";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
