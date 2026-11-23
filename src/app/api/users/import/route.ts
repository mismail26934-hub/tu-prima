import { NextResponse } from "next/server";
import { getCurrentLevel, requirePermission } from "@/lib/access";
import {
  commitUsersImport,
  previewUsersFromBuffer,
  type UserImportCommitRow,
} from "@/lib/excel";

export const dynamic = "force-dynamic";

function denyUnlessSuperuser(level: string) {
  if (level === "superuser") return null;
  if (level === "guest") {
    return NextResponse.json(
      { error: "Silakan login untuk mengakses Master User" },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { error: "Master User hanya untuk superuser" },
    { status: 403 }
  );
}

export async function POST(req: Request) {
  const level = await getCurrentLevel();
  const deniedSu = denyUnlessSuperuser(level);
  if (deniedSu) return deniedSu;
  const denied = await requirePermission("user", "create");
  if (denied) return denied;

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { rows?: UserImportCommitRow[] };
      const result = await commitUsersImport(
        Array.isArray(body.rows) ? body.rows : []
      );
      return NextResponse.json(result);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "File Excel (.xlsx) wajib diunggah" },
        { status: 400 }
      );
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Format harus .xlsx" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await previewUsersFromBuffer(buffer);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import gagal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
