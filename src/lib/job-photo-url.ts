/** Browser-safe helpers for job-level photos (no fs). */

import {
  parseStepPhotos,
  serializeStepPhotos,
  type StepPhotoRef,
  type StepPhotoSize,
} from "@/lib/step-photo-url";

export const MAX_JOB_PHOTOS = 6;

export type JobPhotoRef = StepPhotoRef;

export function jobPhotoPublicUrl(
  jobId: string,
  photoId?: string,
  size: StepPhotoSize = "full"
): string {
  const path = `/api/jobs/${encodeURIComponent(jobId)}/photo`;
  const q = new URLSearchParams();
  if (photoId) q.set("id", photoId);
  if (size === "thumb") q.set("size", "thumb");
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function parseJobPhotos(
  raw: unknown,
  photoName?: string
): JobPhotoRef[] {
  return parseStepPhotos(raw, photoName);
}

export function serializeJobPhotos(photos: JobPhotoRef[]): string {
  return serializeStepPhotos(photos);
}

export function attachJobPhotoUrl<
  T extends {
    id: string;
    photos?: unknown;
    photo_name?: string;
  },
>(job: T): T & { photos: JobPhotoRef[]; photo_name: string } {
  const photos = parseJobPhotos(job.photos, job.photo_name).map((p) => ({
    id: p.id,
    name: p.name,
    url: jobPhotoPublicUrl(job.id, p.id, "full"),
    thumb_url: jobPhotoPublicUrl(job.id, p.id, "thumb"),
  }));
  return {
    ...job,
    photos,
    photo_name: photos[0]?.name || "",
  };
}
