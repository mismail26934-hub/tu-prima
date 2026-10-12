import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { getPool } from "@/db/mysql-workbook";
import {
  attachJobPhotoUrl,
  type JobPhotoRef,
} from "@/lib/job-photo-url";
import { decodePhotoBase64, mimeFromPhotoName } from "@/lib/step-photo";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function photosDir(): string {
  return path.join(process.cwd(), "data", "job-photos");
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

function filePathForName(fileName: string): string {
  const base = path.basename(String(fileName || "").trim());
  return path.join(photosDir(), safeToken(base, "Nama file"));
}

function newPhotoId(jobId: string): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safeToken(jobId, "Job id")}-${rand}`;
}

export async function saveJobPhotoFromBase64(
  jobId: string,
  base64: string,
  mimeHint?: string,
  _originalName?: string,
  thumbBase64?: string
): Promise<JobPhotoRef> {
  const { bytes, mime } = decodePhotoBase64(base64, mimeHint);
  const id = newPhotoId(jobId);
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

export async function deleteOneJobPhoto(photo: JobPhotoRef): Promise<void> {
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

export async function readListedJobPhoto(
  photo: JobPhotoRef,
  size: "full" | "thumb" = "full"
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const id = String(photo.id || "").trim();
  const name = String(photo.name || "").trim();
  const tryNames =
    size === "thumb"
      ? [`${id}.thumb.jpg`, name, `${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`]
      : [name, `${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}.webp`];
  const seen = new Set<string>();
  for (const fileName of tryNames) {
    const base = String(fileName || "").trim();
    if (!base || seen.has(base)) continue;
    seen.add(base);
    try {
      const bytes = await readFile(filePathForName(base));
      return {
        bytes,
        mime: mimeFromPhotoName(base),
        fileName: path.basename(base),
      };
    } catch {
      /* missing or unsafe name */
    }
  }
  return null;
}

export async function lookupJobPhotoAccess(
  jobId: string
): Promise<{ photos: JobPhotoRef[] } | null> {
  const p = getPool();
  const [rows] = await p.query(
    `SELECT id, photo_name, photos
     FROM jobs
     WHERE id = ?
     LIMIT 1`,
    [jobId]
  );
  const row = Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) return null;
  return {
    photos: attachJobPhotoUrl({
      id: String(row.id || jobId),
      photo_name: String(row.photo_name || ""),
      photos: row.photos as string,
    }).photos,
  };
}
