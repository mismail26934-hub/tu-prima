import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { getPool } from "@/db/mysql-workbook";
import { hydrateStepNotes } from "@/lib/step-notes";
import type { JobStepNote } from "@/lib/types";

export const STEP_NOTE_PDF_MAX_BYTES = 2_500_000;
export const STEP_NOTE_PDF_PICK_MAX_BYTES = 5_000_000;

function filesDir(): string {
  return path.join(process.cwd(), "data", "step-note-files");
}

function safeToken(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`${label} PDF tidak valid`);
  }
  return id;
}

function filePathForName(fileName: string): string {
  const base = path.basename(String(fileName || "").trim());
  return path.join(filesDir(), safeToken(base, "Nama file"));
}

function isPdfBytes(bytes: Buffer): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export function decodePdfBase64(raw: string, mimeHint?: string): Buffer {
  let mime = String(mimeHint || "").trim().toLowerCase();
  let payload = String(raw || "").trim();
  const dataUrl = payload.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrl) {
    mime = mime || dataUrl[1].trim().toLowerCase();
    payload = dataUrl[2];
  }
  if (mime && mime !== "application/pdf" && !mime.startsWith("application/pdf")) {
    throw new Error("Lampiran catatan harus PDF");
  }
  if (!payload) throw new Error("File PDF kosong");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    throw new Error("File PDF tidak valid");
  }
  if (!bytes.length) throw new Error("File PDF kosong");
  if (bytes.length > STEP_NOTE_PDF_MAX_BYTES) {
    throw new Error("PDF terlalu besar (maks 2,5 MB)");
  }
  if (!isPdfBytes(bytes)) {
    throw new Error("Lampiran catatan harus PDF");
  }
  return bytes;
}

export async function saveStepNotePdfFromBase64(
  noteId: string,
  base64: string,
  mimeHint?: string,
  originalName?: string
): Promise<{ id: string; name: string; original_name: string }> {
  const id = safeToken(noteId, "Catatan");
  const bytes = decodePdfBase64(base64, mimeHint);
  const name = `${id}.pdf`;
  const original = String(originalName || "lampiran.pdf").trim() || "lampiran.pdf";
  const safeOriginal = original.toLowerCase().endsWith(".pdf")
    ? original
    : `${original}.pdf`;
  await mkdir(filesDir(), { recursive: true });
  await writeFile(filePathForName(name), bytes);
  return { id, name, original_name: safeOriginal.slice(0, 180) };
}

export async function deleteStepNotePdf(note: {
  file_id?: string;
  file_name?: string;
}): Promise<void> {
  const name = String(note.file_name || "").trim();
  const id = String(note.file_id || "").trim();
  for (const file of [name, id ? `${id}.pdf` : ""].filter(Boolean)) {
    try {
      await unlink(filePathForName(file));
    } catch {
      /* missing */
    }
  }
}

export async function readStepNotePdfFile(
  fileName: string
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const name = String(fileName || "").trim();
  if (!name) return null;
  try {
    const bytes = await readFile(filePathForName(name));
    return { bytes, mime: "application/pdf", fileName: name };
  } catch {
    return null;
  }
}

export async function lookupStepNoteFileAccess(
  jobId: string,
  stepId: string,
  noteId: string
): Promise<JobStepNote | null> {
  const p = getPool();
  const [rows] = await p.query(
    `SELECT id, job_id, notes, note
     FROM job_steps
     WHERE id = ? AND job_id = ?
     LIMIT 1`,
    [stepId, jobId]
  );
  const row = Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!row) return null;
  const notes = hydrateStepNotes({
    id: String(row.id || stepId),
    note: String(row.note || ""),
    notes: row.notes,
  });
  const note = notes.find((n) => n.id === String(noteId || "").trim());
  if (!note?.file_id && !note?.file_name) return null;
  return note;
}
