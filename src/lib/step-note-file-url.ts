/** Browser-safe helpers for optional PDF attachments on step notes. */

export function stepNoteFilePublicUrl(
  jobId: string,
  stepId: string,
  noteId: string
): string {
  const path = `/api/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(stepId)}/note-file`;
  const q = new URLSearchParams({ noteId: String(noteId || "").trim() });
  return `${path}?${q.toString()}`;
}
