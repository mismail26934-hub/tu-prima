import { v4 as uuidv4 } from "uuid";
import type {
  Job,
  JobAssignee,
  JobEvent,
  JobHandover,
  JobPartLoan,
  JobStep,
} from "@/lib/types";

export type ArchiveMark = "c" | "d" | "x";

const ARCHIVE_ID_RE = /^(.*)~([cdx])~([0-9a-f]{8})$/i;

export function originalJobIdFromArchive(id: string): string {
  const raw = String(id || "").trim();
  const match = raw.match(ARCHIVE_ID_RE);
  return match ? match[1] : raw;
}

export function makeArchiveJobId(originalId: string, mark: ArchiveMark): string {
  const base = originalJobIdFromArchive(originalId);
  const suffix = uuidv4().replace(/-/g, "").slice(0, 8);
  return `${base}~${mark}~${suffix}`;
}

type JobBundle = {
  job: Job;
  steps: JobStep[];
  events: JobEvent[];
  assignees: JobAssignee[];
  handovers: JobHandover[];
  part_loans: JobPartLoan[];
};

/** Copy a live job into archive rows with unique ids so MySQL PRIMARY KEY does not collide. */
export function cloneJobBundleForArchive<T extends JobBundle>(
  bundle: T,
  mark: ArchiveMark
): T {
  const jobId = makeArchiveJobId(bundle.job.id, mark);
  return {
    ...bundle,
    job: { ...bundle.job, id: jobId },
    steps: bundle.steps.map((s) => ({ ...s, id: uuidv4(), job_id: jobId })),
    events: bundle.events.map((e) => ({ ...e, id: uuidv4(), job_id: jobId })),
    assignees: bundle.assignees.map((a) => ({
      ...a,
      id: uuidv4(),
      job_id: jobId,
    })),
    handovers: bundle.handovers.map((h) => ({
      ...h,
      id: uuidv4(),
      job_id: jobId,
    })),
    part_loans: bundle.part_loans.map((p) => ({
      ...p,
      id: uuidv4(),
      job_id: jobId,
    })),
  };
}

export function pickArchiveBundle<T extends { job: { id: string } }>(
  bundles: T[],
  jobId: string
): T | undefined {
  const want = String(jobId || "").trim();
  if (!want) return undefined;
  const exact = bundles.find((b) => b.job.id === want);
  if (exact) return exact;
  const original = originalJobIdFromArchive(want);
  return bundles.find(
    (b) => originalJobIdFromArchive(b.job.id) === original
  );
}

export function rebindJobBundleIds<T extends JobBundle>(
  bundle: T,
  jobId: string
): T {
  const id = String(jobId || "").trim();
  return {
    ...bundle,
    job: { ...bundle.job, id },
    steps: bundle.steps.map((s) => ({ ...s, job_id: id })),
    events: bundle.events.map((e) => ({ ...e, job_id: id })),
    assignees: bundle.assignees.map((a) => ({ ...a, job_id: id })),
    handovers: bundle.handovers.map((h) => ({ ...h, job_id: id })),
    part_loans: bundle.part_loans.map((p) => ({ ...p, job_id: id })),
  };
}
