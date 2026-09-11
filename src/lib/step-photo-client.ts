export type StepPhotoDraft = {
  previewUrl: string;
  base64: string;
  thumb_base64: string;
  mime: string;
  name: string;
};

const MAX_EDGE = 1280;
const MAX_BYTES = 700_000;
const THUMB_EDGE = 96;

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Gagal membaca foto"));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Format foto tidak didukung"));
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Gagal kompres foto"));
        else resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function dataUrlToBase64(dataUrl: string): { base64: string; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Foto tidak valid");
  return { mime: m[1], base64: m[2] };
}

async function drawJpeg(
  img: HTMLImageElement,
  maxEdge: number,
  maxBytes: number,
  startQuality: number
): Promise<{ dataUrl: string; base64: string }> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gagal kompres foto");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = startQuality;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.1;
    blob = await canvasToJpegBlob(canvas, quality);
  }
  const dataUrl = await fileToDataUrl(blob);
  return { dataUrl, base64: dataUrlToBase64(dataUrl).base64 };
}

/** Resize/compress a picked image so it fits offline JSON + API limits. */
export async function compressStepPhotoFile(file: File): Promise<StepPhotoDraft> {
  if (!file || !file.size) throw new Error("Pilih foto bukti pekerjaan");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("File harus berupa gambar");
  }
  const originalUrl = await fileToDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(originalUrl);
  } catch {
    throw new Error("Tidak bisa membaca foto. Pakai JPEG atau PNG.");
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("Foto tidak valid");
  const full = await drawJpeg(img, MAX_EDGE, MAX_BYTES, 0.72);
  const thumb = await drawJpeg(img, THUMB_EDGE, 40_000, 0.7);
  return {
    previewUrl: thumb.dataUrl,
    base64: full.base64,
    thumb_base64: thumb.base64,
    mime: "image/jpeg",
    name: (file.name || "bukti-step.jpg").replace(/\.[^.]+$/, "") + ".jpg",
  };
}

export async function compressStepPhotoFiles(files: File[]): Promise<StepPhotoDraft[]> {
  const out: StepPhotoDraft[] = [];
  for (const file of files) {
    if (!file || !String(file.type || "").startsWith("image/")) continue;
    out.push(await compressStepPhotoFile(file));
  }
  if (!out.length) throw new Error("Pilih foto bukti pekerjaan");
  return out;
}
