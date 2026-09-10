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

export function unionTechnicianIds(
  ...lists: Array<string[] | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Stored IDs if present, otherwise current assignees. Does not drop unassigned IDs. */
export function frozenStepTechnicianIds(
  step: Pick<JobStep, "technician_ids">,
  assignedIds: string[]
): string[] {
  const stored = parseStepTechnicianIds(step.technician_ids);
  return stored.length ? stored : [...assignedIds];
}

/** Keep step snapshot (or previous assignees) and add newly assigned technicians. */
export function mergeInProgressStepTechnicians(
  step: Pick<JobStep, "technician_ids">,
  previousAssignedIds: string[],
  nextAssignedIds: string[]
): string[] {
  return unionTechnicianIds(
    frozenStepTechnicianIds(step, previousAssignedIds),
    nextAssignedIds
  );
}

export function stampEmptyTechnicianIds(
  step: { technician_ids?: string[] },
  assignedIds: string[]
): void {
  if (parseStepTechnicianIds(step.technician_ids).length) return;
  if (!assignedIds.length) return;
  step.technician_ids = [...assignedIds];
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

/**
 * Done / in_progress keep the snapshot in job_steps.technician_ids
 * (including technicians later removed from the job).
 * Pending still follows current assignees when the list is empty.
 */
export function displayStepTechnicianIds(
  step: Pick<JobStep, "technician_ids" | "status">,
  assignedIds: string[]
): string[] {
  const stored = parseStepTechnicianIds(step.technician_ids);
  if (
    stored.length &&
    (step.status === "done" || step.status === "in_progress")
  ) {
    return stored;
  }
  return resolveStepTechnicianIds(step, assignedIds);
}

export function stepTechnicianNames(
  step: Pick<JobStep, "technician_ids" | "status">,
  job: JobWithDetails
): string {
  const ids = displayStepTechnicianIds(step, assignedTechnicianIds(job));
  const byId = new Map<string, string>();
  for (const t of job.technician_index || []) {
    if (t.id) byId.set(t.id, t.name);
  }
  for (const t of job.technicians || []) {
    if (t.id) byId.set(t.id, t.name);
  }
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
  assignedIds: string[],
  extraAllowedIds: string[] = []
): string[] | undefined {
  if (payloadIds == null) return undefined;
  if (!Array.isArray(payloadIds)) {
    throw new Error("technician_ids tidak valid");
  }
  const allowed = new Set(unionTechnicianIds(assignedIds, extraAllowedIds));
  const next = [
    ...new Set(
      payloadIds.map((id) => String(id || "").trim()).filter((id) => allowed.has(id))
    ),
  ];
  if (allowed.size > 0 && next.length === 0) {
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
