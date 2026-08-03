import type { Job, JobStep } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Active elapsed seconds excluding paused time. */
export function calcElapsedSec(job: Job, at: Date = new Date()): number {
  const started = parseDate(job.started_at);
  if (!started) return 0;

  let end = at;
  if (job.status === "done" || job.status === "cancelled") {
    end = parseDate(job.completed_at) ?? at;
  }

  let pausedExtra = 0;
  if (job.status === "paused") {
    const pausedAt = parseDate(job.paused_at);
    if (pausedAt) pausedExtra = Math.max(0, (at.getTime() - pausedAt.getTime()) / 1000);
  }

  const raw = Math.max(0, (end.getTime() - started.getTime()) / 1000);
  return Math.floor(raw - (job.total_paused_sec || 0) - pausedExtra);
}

export function calcStepElapsedSec(step: JobStep, at: Date = new Date()): number {
  if (step.status === "done") return step.duration_sec || 0;
  const started = parseDate(step.started_at);
  if (!started || step.status !== "in_progress") return 0;
  return Math.floor(Math.max(0, (at.getTime() - started.getTime()) / 1000));
}

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function calcProgressPct(steps: JobStep[]): number {
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.status === "done").length;
  const inProgress = steps.some((s) => s.status === "in_progress") ? 0.5 : 0;
  return Math.min(100, Math.round(((done + inProgress) / steps.length) * 100));
}
