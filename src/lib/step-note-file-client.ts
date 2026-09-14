export const STEP_NOTE_PDF_PICK_MAX_BYTES = 5_000_000;
export const STEP_NOTE_PDF_MAX_BYTES = 2_500_000;

export type StepNotePdfDraft = {
  base64: string;
  mime: string;
  name: string;
};

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Gagal membaca PDF"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): { base64: string; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) throw new Error("PDF tidak valid");
  return { mime: m[1], base64: m[2] };
}

export async function readStepNotePdfFile(file: File): Promise<StepNotePdfDraft> {
  if (!file || !file.size) throw new Error("Pilih file PDF");
  const name = String(file.name || "lampiran.pdf").trim() || "lampiran.pdf";
  const mime = String(file.type || "").trim().toLowerCase();
  const isPdf =
    mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Lampiran catatan harus PDF");
  if (file.size > STEP_NOTE_PDF_PICK_MAX_BYTES) {
    throw new Error("PDF terlalu besar (maks 5 MB saat memilih)");
  }
  if (file.size > STEP_NOTE_PDF_MAX_BYTES) {
    throw new Error("PDF terlalu besar (maks 2,5 MB)");
  }
  const dataUrl = await fileToDataUrl(file);
  const parsed = dataUrlToBase64(dataUrl);
  return {
    base64: parsed.base64,
    mime: "application/pdf",
    name: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
  };
}
