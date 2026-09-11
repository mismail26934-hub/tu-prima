/** In-memory previews for photos queued offline (not persisted). */
const previews = new Map<string, string>();

export function cacheStepPhotoPreview(stepId: string, dataUrl: string) {
  const id = String(stepId || "").trim();
  if (!id || !dataUrl) return;
  previews.set(id, dataUrl);
}

export function getStepPhotoPreview(stepId: string): string {
  return previews.get(String(stepId || "").trim()) || "";
}

export function stepPhotoDisplayUrl(step: {
  id: string;
  photo_url?: string;
}): string {
  return getStepPhotoPreview(step.id) || String(step.photo_url || "").trim();
}
