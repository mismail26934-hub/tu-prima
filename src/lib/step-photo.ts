import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

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

function safeStepId(stepId: string): string {
  const id = String(stepId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error("Step id foto tidak valid");
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

function filePathFor(stepId: string, photoName: string): string {
  const id = safeStepId(stepId);
  const ext = String(photoName || "").split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg"
    ? ext === "jpeg"
      ? "jpg"
      : ext
    : "jpg";
  return path.join(photosDir(), `${id}.${safeExt}`);
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
  _originalName?: string
): Promise<string> {
  const { bytes, mime } = decodePhotoBase64(base64, mimeHint);
  const id = safeStepId(stepId);
  const ext = extFromMime(mime);
  const fileName = `${id}.${ext}`;
  await mkdir(photosDir(), { recursive: true });
  for (const oldExt of ["jpg", "jpeg", "png", "webp"]) {
    if (oldExt === ext || (oldExt === "jpeg" && ext === "jpg")) continue;
    try {
      await unlink(path.join(photosDir(), `${id}.${oldExt}`));
    } catch {
      /* missing */
    }
  }
  await writeFile(filePathFor(id, fileName), bytes);
  return fileName;
}

export async function readStepPhotoFile(
  stepId: string,
  photoName: string
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const name = String(photoName || "").trim();
  if (!name) return null;
  try {
    const bytes = await readFile(filePathFor(stepId, name));
    return {
      bytes,
      mime: mimeFromPhotoName(name),
      fileName: name,
    };
  } catch {
    return null;
  }
}

export async function deleteStepPhotoFiles(
  stepId: string,
  photoName?: string
): Promise<void> {
  const id = String(stepId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
  const names = new Set<string>();
  if (photoName) names.add(photoName);
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    names.add(`${id}.${ext}`);
  }
  for (const name of names) {
    try {
      await unlink(filePathFor(id, name));
    } catch {
      /* missing */
    }
  }
}
