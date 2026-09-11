import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { getPool } from "@/db/mysql-workbook";
import {
  attachStepPhotoUrl,
  parseStepPhotos,
  type StepPhotoRef,
} from "@/lib/step-photo-url";

export const STEP_PHOTO_MAX_BYTES = 2_500_000;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function photosDir(): string {
  return path.join(process.cwd(), "data", "step-photos");
}

function safeToken(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`${label} foto tidak valid`);
  }
  return id;
}

function extFromMime(mime: string): string {
  const ext = ALLOWED_MIME[String(mime || "").trim().toLowerCase()];
  if (!ext) {
    throw new Error("Format foto harus JPEG, PNG, atau WebP");
  }
  return ext;
}

export function mimeFromPhotoName(photoName: string): string {
  const ext = String(photoName || "").split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function photoBelongsToStep(stepId: string, photoId: string): boolean {
  return photoId === stepId || photoId.startsWith(`${stepId}-`);
}

function filePathForName(fileName: string): string {
  const base = path.basename(String(fileName || "").trim());
  return path.join(photosDir(), safeToken(base, "Nama file"));
}

function newPhotoId(stepId: string): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safeToken(stepId, "Step id")}-${rand}`;
}

export function decodePhotoBase64(
  raw: string,
  mimeHint?: string
): { bytes: Buffer; mime: string } {
  let mime = String(mimeHint || "").trim().toLowerCase();
  let payload = String(raw || "").trim();
  const dataUrl = payload.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrl) {
    mime = mime || dataUrl[1].trim().toLowerCase();
    payload = dataUrl[2];
  }
  if (!payload) throw new Error("Foto bukti kosong");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    throw new Error("Foto bukti tidak valid");
  }
  if (!bytes.length) throw new Error("Foto bukti kosong");
  if (bytes.length > STEP_PHOTO_MAX_BYTES) {
    throw new Error("Foto bukti terlalu besar (maks 2.5 MB)");
  }
  if (!mime) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = "image/png";
    else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = "image/webp";
    else mime = "image/jpeg";
  }
  extFromMime(mime);
  return { bytes, mime };
}

export async function saveStepPhotoFromBase64(
  stepId: string,
  base64: string,
  mimeHint?: string,
  _originalName?: string,
  thumbBase64?: string
): Promise<StepPhotoRef> {
  const { bytes, mime } = decodePhotoBase64(base64, mimeHint);
  const id = newPhotoId(stepId);
  const ext = extFromMime(mime);
  const name = `${id}.${ext}`;
  await mkdir(photosDir(), { recursive: true });
  await writeFile(filePathForName(name), bytes);
  if (thumbBase64) {
    try {
      const thumb = decodePhotoBase64(thumbBase64, "image/jpeg");
      await writeFile(filePathForName(`${id}.thumb.jpg`), thumb.bytes);
    } catch {
      /* thumb optional */
    }
  }
  return { id, name };
}

/** Legacy single-file names used before multi-photo. */
async function deleteLegacyStepFiles(stepId: string): Promise<void> {
  const id = String(stepId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
  for (const name of [`${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`, `${id}.thumb.jpg`]) {
    try {
      await unlink(filePathForName(name));
    } catch {
      /* missing */
    }
  }
}

export async function deleteOneStepPhoto(photo: StepPhotoRef): Promise<void> {
  const id = String(photo.id || "").trim();
  const name = String(photo.name || "").trim();
  for (const file of [name, id ? `${id}.thumb.jpg` : ""].filter(Boolean)) {
    try {
      await unlink(filePathForName(file));
    } catch {
      /* missing */
    }
  }
}

export async function deleteStepPhotoFiles(
  stepId: string,
  photoNameOrList?: string | StepPhotoRef[]
): Promise<void> {
  const listed = Array.isArray(photoNameOrList)
    ? photoNameOrList
    : parseStepPhotos(undefined, String(photoNameOrList || ""));
  for (const photo of listed) {
    await deleteOneStepPhoto(photo);
  }
  await deleteLegacyStepFiles(stepId);
}

export async function readStepPhotoFile(
  stepId: string,
  photoId: string,
  size: "full" | "thumb" = "full"
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const id = String(photoId || stepId || "").trim();
  if (!id || !photoBelongsToStep(stepId, id)) return null;
  const tryNames =
    size === "thumb"
      ? [`${id}.thumb.jpg`, `${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`]
      : [`${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`];
  for (const fileName of tryNames) {
    try {
      const bytes = await readFile(filePathForName(fileName));
      return { bytes, mime: mimeFromPhotoName(fileName), fileName };
    } catch {
      /* next */
    }
  }
  return null;
}

export async function lookupStepPhotoAccess(
  jobId: string,
  stepId: string
): Promise<{ photos: StepPhotoRef[] } | null> {
  const p = getPool();
  const [rows] = await p.query(
    `SELECT id, job_id, photo_name, photos
     FROM job_steps
     WHERE id = ? AND job_id = ?
     LIMIT 1`,
    [stepId, jobId]
  );
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  return {
    photos: attachStepPhotoUrl({
      id: String(row.id || stepId),
      job_id: String(row.job_id || jobId),
      photo_name: String(row.photo_name || ""),
      photos: row.photos as string,
    }).photos,
  };
}
