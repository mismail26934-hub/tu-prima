/** In-memory previews for photos queued offline (not persisted). */
const previews = new Map<string, string[]>();

export function cacheStepPhotoPreview(stepId: string, dataUrl: string) {
  const id = String(stepId || "").trim();
  if (!id || !dataUrl) return;
  const current = previews.get(id) || [];
  previews.set(id, [...current, dataUrl]);
}

export function cacheStepPhotoPreviews(stepId: string, dataUrls: string[]) {
  const id = String(stepId || "").trim();
  if (!id) return;
  const next = dataUrls.filter(Boolean);
  if (!next.length) return;
  previews.set(id, [...(previews.get(id) || []), ...next]);
}

export function getStepPhotoPreview(stepId: string): string {
  return (previews.get(String(stepId || "").trim()) || [])[0] || "";
}

export function getStepPhotoPreviews(stepId: string): string[] {
  return previews.get(String(stepId || "").trim()) || [];
}

export function stepPhotoDisplayUrl(step: {
  id: string;
  photos?: Array<{ thumb_url?: string; url?: string }>;
  photo_url?: string;
}): string {
  return (
    getStepPhotoPreview(step.id) ||
    step.photos?.[0]?.thumb_url ||
    step.photos?.[0]?.url ||
    String(step.photo_url || "").trim()
  );
}
