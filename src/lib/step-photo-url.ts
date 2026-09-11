/** Browser-safe helpers for step evidence photos (no fs). */

export function stepPhotoPublicUrl(jobId: string, stepId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(stepId)}/photo`;
}

export function stepHasPhoto(step: {
  photo_name?: string;
  photo_url?: string;
}): boolean {
  return Boolean(
    String(step.photo_name || "").trim() || String(step.photo_url || "").trim()
  );
}

export function attachStepPhotoUrl<
  T extends {
    id: string;
    job_id: string;
    photo_name?: string;
    photo_url?: string;
  },
>(step: T): T {
  const photo_name = String(step.photo_name || "").trim();
  return {
    ...step,
    photo_name,
    photo_url: photo_name ? stepPhotoPublicUrl(step.job_id, step.id) : "",
  };
}
