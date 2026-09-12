import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { decodePhotoBase64, mimeFromPhotoName } from "@/lib/step-photo";

function photosDir(): string {
  return path.join(process.cwd(), "data", "user-photos");
}

function safeUserId(userId: string): string {
  const id = String(userId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error("User id foto tidak valid");
  }
  return id;
}

export function userPhotoPublicUrl(photoName: string): string {
  const name = String(photoName || "").trim();
  if (!name) return "";
  return `/api/account/photo?v=${encodeURIComponent(name)}`;
}

export async function saveUserPhotoFromBase64(
  userId: string,
  base64: string,
  mimeHint?: string
): Promise<string> {
  const id = safeUserId(userId);
  const { bytes, mime } = decodePhotoBase64(base64, mimeHint);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const name = `${id}.${ext}`;
  await mkdir(photosDir(), { recursive: true });
  await deleteUserPhotoFiles(id);
  await writeFile(path.join(photosDir(), name), bytes);
  return name;
}

export async function deleteUserPhotoFiles(userId: string): Promise<void> {
  const id = String(userId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
  for (const name of [`${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`]) {
    try {
      await unlink(path.join(photosDir(), name));
    } catch {
      /* missing */
    }
  }
}

export async function readUserPhotoFile(
  userId: string,
  photoName?: string
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const id = String(userId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const preferred = path.basename(String(photoName || "").trim());
  const tryNames = [
    preferred,
    `${id}.jpg`,
    `${id}.jpeg`,
    `${id}.png`,
    `${id}.webp`,
  ].filter(Boolean);
  const seen = new Set<string>();
  for (const fileName of tryNames) {
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    try {
      const bytes = await readFile(path.join(photosDir(), fileName));
      return { bytes, mime: mimeFromPhotoName(fileName), fileName };
    } catch {
      /* next */
    }
  }
  return null;
}
