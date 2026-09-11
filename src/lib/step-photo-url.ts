/** Browser-safe helpers for step evidence photos (no fs). */

export const MAX_STEP_PHOTOS = 6;

export type StepPhotoSize = "full" | "thumb";

export type StepPhotoRef = {
  id: string;
  name: string;
  url?: string;
  thumb_url?: string;
};

export function stepPhotoPublicUrl(
  jobId: string,
  stepId: string,
  photoId?: string,
  size: StepPhotoSize = "full"
): string {
  const path = `/api/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(stepId)}/photo`;
  const q = new URLSearchParams();
  if (photoId) q.set("id", photoId);
  if (size === "thumb") q.set("size", "thumb");
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

function stemFromName(name: string): string {
  return String(name || "").replace(/\.[^.]+$/, "");
}

export function parseStepPhotos(
  raw: unknown,
  photoName?: string
): StepPhotoRef[] {
  const items: StepPhotoRef[] = [];
  let value: unknown = raw;
  if (typeof value === "string" && value.trim()) {
    try {
      value = JSON.parse(value);
    } catch {
      value = String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  if (Array.isArray(value)) {
    for (const row of value) {
      if (typeof row === "string" && row.trim()) {
        const name = row.trim();
        items.push({ id: stemFromName(name) || name, name });
        continue;
      }
      if (row && typeof row === "object") {
        const rec = row as Record<string, unknown>;
        const name = String(rec.name || "").trim();
        const id = String(rec.id || stemFromName(name)).trim();
        if (id && name) {
          items.push({
            id,
            name,
            url: rec.url ? String(rec.url) : undefined,
            thumb_url: rec.thumb_url ? String(rec.thumb_url) : undefined,
          });
        }
      }
    }
  }
  if (!items.length) {
    const legacy = String(photoName || "").trim();
    if (legacy) items.push({ id: stemFromName(legacy) || legacy, name: legacy });
  }
  return items;
}

export function serializeStepPhotos(photos: StepPhotoRef[]): string {
  return JSON.stringify(
    photos.map((p) => ({ id: p.id, name: p.name }))
  );
}

export function stepHasPhoto(step: {
  photos?: StepPhotoRef[] | string;
  photo_name?: string;
  photo_url?: string;
}): boolean {
  if (parseStepPhotos(step.photos, step.photo_name).length) return true;
  return Boolean(String(step.photo_url || "").trim());
}

export function attachStepPhotoUrl<
  T extends {
    id: string;
    job_id: string;
    photos?: StepPhotoRef[] | string;
    photo_name?: string;
    photo_url?: string;
  },
>(step: T): T & { photos: StepPhotoRef[] } {
  const photos = parseStepPhotos(step.photos, step.photo_name).map((p) => ({
    id: p.id,
    name: p.name,
    url: stepPhotoPublicUrl(step.job_id, step.id, p.id, "full"),
    thumb_url: stepPhotoPublicUrl(step.job_id, step.id, p.id, "thumb"),
  }));
  return {
    ...step,
    photos,
    photo_name: photos[0]?.name || "",
    photo_url: photos[0]?.url || "",
  };
}

export function firstStepThumbUrl(step: {
  id: string;
  job_id: string;
  photos?: StepPhotoRef[] | string;
  photo_name?: string;
  photo_url?: string;
}): string {
  const photos = attachStepPhotoUrl(step).photos;
  return photos[0]?.thumb_url || photos[0]?.url || "";
}

export function stepPhotoCount(step: {
  photos?: StepPhotoRef[] | string;
  photo_name?: string;
}): number {
  return parseStepPhotos(step.photos, step.photo_name).length;
}
