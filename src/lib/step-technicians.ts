import type { Job, JobStep, JobWithDetails, Technician } from "./types";

export function parseStepTechnicianIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))];
  }
  const text = raw == null ? "" : String(raw).trim();
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[,;\s]+/)
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
}

export function serializeStepTechnicianIds(ids?: string[]): string {
  return [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))].join(",");
}

export function assignedTechnicianIds(
  job: Pick<JobWithDetails, "technicians" | "technician" | "technician_id">
): string[] {
  if (job.technicians?.length) {
    return [...new Set(job.technicians.map((t) => t.id).filter(Boolean))];
  }
  if (job.technician?.id) return [job.technician.id];
  if (job.technician_id) return [job.technician_id];
  return [];
}

export function assignedIdsFromAssignees(
  job: Pick<Job, "id" | "technician_id">,
  assignees: Array<{ job_id: string; technician_id: string }>
): string[] {
  const ids = assignees
    .filter((a) => a.job_id === job.id)
    .map((a) => String(a.technician_id || "").trim())
    .filter(Boolean);
  if (!ids.length && job.technician_id) return [job.technician_id];
  return [...new Set(ids)];
}

/** Empty stored list = all currently assigned technicians. */
export function resolveStepTechnicianIds(
  step: Pick<JobStep, "technician_ids">,
  assignedIds: string[]
): string[] {
  const stored = parseStepTechnicianIds(step.technician_ids);
  if (!stored.length) return assignedIds;
  const allowed = new Set(assignedIds);
  const filtered = stored.filter((id) => allowed.has(id));
  return filtered.length ? filtered : assignedIds;
}

export function stepTechnicianNames(
  step: Pick<JobStep, "technician_ids">,
  job: JobWithDetails
): string {
  const ids = resolveStepTechnicianIds(step, assignedTechnicianIds(job));
  const byId = new Map((job.technicians || []).map((t) => [t.id, t.name]));
  if (job.technician?.id && job.technician.name) {
    byId.set(job.technician.id, job.technician.name);
  }
  return ids
    .map((id) => byId.get(id) || "")
    .filter(Boolean)
    .join(", ");
}

/**
 * `undefined` = payload omitted (keep implicit “all assigned”).
 * Otherwise only IDs that belong to the job are kept.
 */
export function selectedStepTechnicianIds(
  payloadIds: unknown,
  assignedIds: string[]
): string[] | undefined {
  if (payloadIds == null) return undefined;
  if (!Array.isArray(payloadIds)) {
    throw new Error("technician_ids tidak valid");
  }
  const allowed = new Set(assignedIds);
  const next = [
    ...new Set(
      payloadIds.map((id) => String(id || "").trim()).filter((id) => allowed.has(id))
    ),
  ];
  if (assignedIds.length > 0 && next.length === 0) {
    throw new Error("Pilih minimal satu teknisi yang ditugaskan");
  }
  return next;
}

export function technicianNamesByIds(
  ids: string[],
  techs: Technician[]
): string {
  const byId = new Map(techs.map((t) => [t.id, t.name]));
  return ids
    .map((id) => byId.get(id) || "")
    .filter(Boolean)
    .join(", ");
}
