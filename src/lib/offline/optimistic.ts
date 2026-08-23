import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  Attendance,
  AttendanceStatus,
  DashboardData,
  Job,
  JobHandover,
  JobPartLoan,
  JobStep,
  JobTemplate,
  JobTemplateCategory,
  JobWithDetails,
  PartLoanStatus,
  Technician,
  TechnicianStatus,
  Unit,
} from "@/lib/types";
import { newEntityId, type JobStepPayload, type JsonRecord } from "./ids";

function nowIso() {
  return new Date().toISOString();
}

function freezeStepDuration(step: JobStep, at: Date = new Date()): number {
  const accrued = Math.max(0, Number(step.duration_sec || 0));
  // Already finalized (e.g. optimistic complete_step before a second prepare).
  // Re-adding (now - started_at) would double the timer.
  if (step.status === "done") return accrued;
  if (!step.started_at) return accrued;
  const started = Date.parse(step.started_at);
  if (!Number.isFinite(started)) return accrued;
  return accrued + Math.max(0, Math.floor((at.getTime() - started) / 1000));
}

function pathOf(url: string) {
  return url.split("?")[0];
}

function parseBody(raw: string | null): JsonRecord {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function unitLabel(unit: Unit) {
  return unit.name ? `${unit.code} — ${unit.name}` : unit.code;
}

function progressPct(steps: JobStep[]) {
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.status === "done").length;
  return Math.round((done / steps.length) * 100);
}

function enrich(job: JobWithDetails): JobWithDetails {
  const current_steps = job.steps.filter((s) => s.status === "in_progress");
  return {
    ...job,
    current_steps,
    current_step: current_steps[0] || null,
    progress_pct: progressPct(job.steps),
    technician: job.technicians[0] || job.technician || null,
  };
}

function recount(data: DashboardData): DashboardData {
  const techs = data.technicians;
  const jobs = data.jobs;
  return {
    ...data,
    summary: {
      ...data.summary,
      available: techs.filter((t) => t.status === "available").length,
      busy: techs.filter((t) => t.status === "busy").length,
      offline: techs.filter((t) => t.status === "offline").length,
      active_jobs: jobs.filter(
        (j) => j.status === "in_progress" || j.status === "paused"
      ).length,
      queued_jobs: jobs.filter(
        (j) => j.status === "queued" || j.status === "assigned"
      ).length,
      completed_jobs: data.completed_jobs.length,
      cancelled_jobs: data.cancelled_jobs.length,
    },
  };
}

function patchDashboard(
  qc: QueryClient,
  updater: (data: DashboardData) => DashboardData
) {
  const current = qc.getQueryData<DashboardData>(queryKeys.dashboard);
  if (!current) return;
  qc.setQueryData(queryKeys.dashboard, recount(updater(current)));
}

function mapJob(
  data: DashboardData,
  jobId: string,
  fn: (job: JobWithDetails) => JobWithDetails
): DashboardData {
  return {
    ...data,
    jobs: data.jobs.map((job) => (job.id === jobId ? enrich(fn(job)) : job)),
    completed_jobs: data.completed_jobs.map((job) =>
      job.id === jobId ? enrich(fn(job)) : job
    ),
    cancelled_jobs: data.cancelled_jobs.map((job) =>
      job.id === jobId ? enrich(fn(job)) : job
    ),
  };
}

function findJob(data: DashboardData, jobId: string) {
  return (
    data.jobs.find((j) => j.id === jobId) ||
    data.completed_jobs.find((j) => j.id === jobId) ||
    data.cancelled_jobs.find((j) => j.id === jobId)
  );
}

export function findTemplate(
  qc: QueryClient,
  id: string
): JobTemplate | undefined {
  return (
    qc.getQueryData<JobTemplate>(queryKeys.templates.detail(id, false)) ||
    qc.getQueryData<JobTemplate>(queryKeys.templates.detail(id, true)) ||
    qc
      .getQueryData<{ templates: JobTemplate[] }>(queryKeys.templates.catalog)
      ?.templates.find((t) => t.id === id) ||
    qc
      .getQueryData<{ templates: JobTemplate[] }>(queryKeys.templates.master)
      ?.templates.find((t) => t.id === id)
  );
}

function templateStepDefs(template: JobTemplate): JobStepPayload[] {
  return template.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: newEntityId("S"),
      name: s.phase ? `${s.phase}: ${s.name}` : s.name,
      std_minutes: Number(s.std_minutes || 0),
    }));
}

function toJobSteps(jobId: string, defs: JobStepPayload[]): JobStep[] {
  return defs.map((def, i) => ({
    id: def.id,
    job_id: jobId,
    name: def.name,
    order: i + 1,
    status: "pending",
    started_at: "",
    completed_at: "",
    duration_sec: 0,
    std_minutes: Number(def.std_minutes || 0),
  }));
}

function emptyJob(partial: Partial<Job> & Pick<Job, "id" | "title">): JobWithDetails {
  const job: JobWithDetails = {
    id: partial.id,
    title: partial.title,
    unit: partial.unit || "",
    unit_id: partial.unit_id || "",
    description: partial.description || "",
    status: partial.status || "queued",
    technician_id: partial.technician_id || "",
    template_id: partial.template_id || "",
    created_at: partial.created_at || nowIso(),
    started_at: partial.started_at || "",
    completed_at: partial.completed_at || "",
    paused_at: partial.paused_at || "",
    total_paused_sec: partial.total_paused_sec || 0,
    estimated_minutes: partial.estimated_minutes || 60,
    technician: null,
    technicians: [],
    steps: [],
    events: [],
    handovers: [],
    part_loans: [],
    elapsed_sec: 0,
    progress_pct: 0,
    current_step: null,
    current_steps: [],
  };
  return job;
}

function applyJobAction(
  data: DashboardData,
  jobId: string,
  body: JsonRecord
): DashboardData {
  const action = String(body.action || "");
  const job = findJob(data, jobId);
  if (!job && action !== "reopen") return data;

  if (action === "assign") {
    const ids = (
      Array.isArray(body.technician_ids)
        ? body.technician_ids.map(String)
        : body.technician_id
          ? [String(body.technician_id)]
          : []
    ).filter(Boolean);
    const selected = ids
      .map((id) => data.technicians.find((t) => t.id === id))
      .filter((t): t is Technician => Boolean(t));
    if (!selected.length || !job) return data;
    const selectedIds = new Set(selected.map((t) => t.id));
    return {
      ...data,
      technicians: data.technicians.map((t) => {
        if (t.current_job_id === jobId) {
          return { ...t, status: "available" as TechnicianStatus, current_job_id: "" };
        }
        if (selectedIds.has(t.id)) {
          return { ...t, status: "busy" as TechnicianStatus, current_job_id: jobId };
        }
        return t;
      }),
      jobs: data.jobs.map((j) =>
        j.id !== jobId
          ? j
          : enrich({
              ...j,
              technician_id: selected[0].id,
              status: j.status === "queued" ? "assigned" : j.status,
              technicians: selected,
              technician: selected[0],
            })
      ),
    };
  }

  if (action === "start" || action === "resume") {
    const clockAt = String(
      action === "resume"
        ? body.resumed_at || nowIso()
        : body.started_at || nowIso()
    );
    return {
      ...mapJob(data, jobId, (j) => {
        const extraPause =
          action === "resume" && j.paused_at
            ? Math.max(
                0,
                Math.floor((Date.parse(clockAt) - Date.parse(j.paused_at)) / 1000) ||
                  0
              )
            : 0;
        const totalPaused =
          action === "resume"
            ? typeof body.total_paused_sec === "number"
              ? Math.max(0, Math.floor(body.total_paused_sec))
              : Math.max(0, (j.total_paused_sec || 0) + extraPause)
            : j.total_paused_sec;
        return {
        ...j,
        status: "in_progress",
        started_at: j.started_at || clockAt,
        paused_at: "",
        total_paused_sec: totalPaused,
        steps:
          action === "resume"
            ? j.steps.map((s) =>
                s.status === "in_progress" && !s.started_at
                  ? { ...s, started_at: clockAt }
                  : s
              )
            : action === "start" &&
                body.auto_start_first !== false &&
                j.steps.every((s) => s.status === "pending")
              ? j.steps.map((s, i) =>
                  i === 0
                    ? { ...s, status: "in_progress", started_at: clockAt }
                    : s
                )
              : j.steps,
        };
      }),
      technicians: data.technicians.map((t) =>
        t.current_job_id === jobId ? { ...t, status: "busy" } : t
      ),
    };
  }

  if (action === "pause") {
    const pausedAt = String(body.paused_at || nowIso());
    const snaps = Array.isArray(body.step_snapshots)
      ? (body.step_snapshots as Array<{ id?: string; duration_sec?: number }>)
      : [];
    const byId = new Map(snaps.map((s) => [String(s.id || ""), s]));
    return mapJob(data, jobId, (j) => ({
      ...j,
      status: "paused",
      paused_at: pausedAt,
      steps: j.steps.map((s) => {
        if (s.status !== "in_progress") return s;
        const snap = byId.get(s.id);
        return {
          ...s,
          duration_sec:
            typeof snap?.duration_sec === "number"
              ? snap.duration_sec
              : freezeStepDuration(s),
          started_at: "",
        };
      }),
    }));
  }

  if (action === "start_step" || action === "start_steps") {
    const ids = new Set(
      (
        Array.isArray(body.step_ids)
          ? body.step_ids.map(String)
          : body.step_id
            ? [String(body.step_id)]
            : []
      ).filter(Boolean)
    );
    const at = String(body.started_at || nowIso());
    return mapJob(data, jobId, (j) => ({
      ...j,
      status: j.status === "assigned" || j.status === "queued" ? "in_progress" : j.status,
      started_at: j.started_at || at,
      steps: j.steps.map((s) =>
        ids.has(s.id)
          ? { ...s, status: "in_progress", started_at: s.started_at || at }
          : s
      ),
    }));
  }

  if (action === "complete_step") {
    const stepId = String(body.step_id || "");
    const autoNext =
      body.auto_next === true ||
      (body.step_mode === "sequential" && body.auto_next !== false);
    const at = String(body.completed_at || nowIso());
    const nextAt = String(body.next_started_at || at);
    return mapJob(data, jobId, (j) => {
      const steps = j.steps.map((s) => {
        if (s.id !== stepId) return s;
        const duration =
          typeof body.duration_sec === "number"
            ? Math.max(0, Math.floor(body.duration_sec))
            : freezeStepDuration(s);
        return {
          ...s,
          status: "done" as const,
          completed_at: at,
          // Keep original start for history/payload; duration_sec is final.
          // freezeStepDuration ignores started_at when status === "done".
          started_at: String(body.started_at || s.started_at || at),
          duration_sec: duration,
        };
      });
      if (autoNext) {
        const next = steps.find((s) => s.status === "pending");
        if (next && !steps.some((s) => s.status === "in_progress")) {
          next.status = "in_progress";
          next.started_at = nextAt;
        }
      }
      return { ...j, steps };
    });
  }

  if (action === "complete" && job) {
    const completedAt = String(body.completed_at || nowIso());
    const snaps = Array.isArray(body.step_snapshots)
      ? (body.step_snapshots as Array<{ id?: string; duration_sec?: number }>)
      : [];
    const byId = new Map(snaps.map((s) => [String(s.id || ""), s]));
    const done: JobWithDetails = enrich({
      ...job,
      status: "done",
      completed_at: completedAt,
      paused_at: "",
      from_archive: true,
      steps: job.steps.map((s) => {
        if (s.status === "done") return s;
        const snap = byId.get(s.id);
        return {
          ...s,
          status: "done" as const,
          completed_at: s.completed_at || completedAt,
          duration_sec:
            typeof snap?.duration_sec === "number"
              ? snap.duration_sec
              : s.status === "in_progress"
                ? freezeStepDuration(s)
                : s.duration_sec,
        };
      }),
    });
    return {
      ...data,
      jobs: data.jobs.filter((j) => j.id !== jobId),
      completed_jobs: [done, ...data.completed_jobs],
      technicians: data.technicians.map((t) =>
        t.current_job_id === jobId
          ? { ...t, status: "available" as TechnicianStatus, current_job_id: "" }
          : t
      ),
    };
  }

  if (action === "cancel" && job) {
    const cancelled: JobWithDetails = enrich({
      ...job,
      status: "cancelled",
      completed_at: nowIso(),
      from_archive: true,
    });
    return {
      ...data,
      jobs: data.jobs.filter((j) => j.id !== jobId),
      cancelled_jobs: [cancelled, ...data.cancelled_jobs],
      technicians: data.technicians.map((t) =>
        t.current_job_id === jobId
          ? { ...t, status: "available" as TechnicianStatus, current_job_id: "" }
          : t
      ),
    };
  }

  if (action === "reopen") {
    const archived =
      data.completed_jobs.find((j) => j.id === jobId) ||
      data.cancelled_jobs.find((j) => j.id === jobId);
    if (!archived) return data;
    const restored = enrich({
      ...archived,
      status: archived.started_at ? "paused" : archived.technicians.length ? "assigned" : "queued",
      completed_at: "",
      paused_at: archived.started_at ? nowIso() : "",
      from_archive: false,
    });
    return {
      ...data,
      jobs: [...data.jobs, restored],
      completed_jobs: data.completed_jobs.filter((j) => j.id !== jobId),
      cancelled_jobs: data.cancelled_jobs.filter((j) => j.id !== jobId),
    };
  }

  return data;
}

function createJobOptimistic(
  qc: QueryClient,
  data: DashboardData,
  body: JsonRecord
): DashboardData {
  const id = String(body.id || newEntityId("J"));
  if (data.jobs.some((j) => j.id === id)) return data;
  const unit = data.units.find((u) => u.id === String(body.unit_id || ""));
  const templateId = String(body.template_id || "");
  const template = templateId ? findTemplate(qc, templateId) : undefined;
  let stepDefs = Array.isArray(body.steps)
    ? (body.steps as JobStepPayload[]).filter((s) => s && s.name)
    : [];
  if (!stepDefs.length && template) stepDefs = templateStepDefs(template);
  if (!stepDefs.length) {
    stepDefs = ["Diagnosis", "Perbaikan", "Test & QC"].map((name) => ({
      id: newEntityId("S"),
      name,
      std_minutes: 0,
    }));
  }
  const estimated =
    Number(template?.std_minutes || body.estimated_minutes || 60) || 60;
  const job = enrich({
    ...emptyJob({
      id,
      title: String(body.title || "Job"),
      unit: unit ? unitLabel(unit) : "",
      unit_id: unit?.id || String(body.unit_id || ""),
      description: String(body.description || ""),
      template_id: templateId,
      estimated_minutes: estimated,
    }),
    steps: toJobSteps(id, stepDefs),
  });
  return { ...data, jobs: [job, ...data.jobs] };
}

function patchTemplates(
  qc: QueryClient,
  updater: (list: JobTemplate[]) => JobTemplate[]
) {
  for (const key of [queryKeys.templates.catalog, queryKeys.templates.master]) {
    const current = qc.getQueryData<{ templates: JobTemplate[] }>(key);
    if (!current) continue;
    qc.setQueryData(key, { templates: updater(current.templates) });
  }
}


export function prepareJobActionBody(
  qc: QueryClient | null,
  url: string,
  method: string,
  body: JsonRecord
): JsonRecord {
  if (method !== "POST" || !qc) return body;
  const match = url.split("?")[0].match(/^\/api\/jobs\/([^/]+)\/action$/);
  if (!match) return body;
  const action = String(body.action || "");
  const data = qc.getQueryData<DashboardData>(queryKeys.dashboard);
  const job = data ? findJob(data, match[1]) : undefined;
  if (!job) return body;
  const at = new Date();
  const atIso = at.toISOString();

  if (action === "complete_step") {
    const step = job.steps.find((s) => s.id === String(body.step_id || ""));
    if (!step) return body;
    const completedAt = String(body.completed_at || atIso);
    // Prefer existing body.duration_sec (first prepare). If cache already
    // marked the step done (second prepare after onMutate), keep duration_sec
    // — do not freeze again or the online timer doubles.
    const durationSec =
      typeof body.duration_sec === "number"
        ? Math.max(0, Math.floor(body.duration_sec))
        : step.status === "done"
          ? Math.max(0, Math.floor(Number(step.duration_sec || 0)))
          : freezeStepDuration(step, at);
    return {
      ...body,
      completed_at: completedAt,
      started_at: String(body.started_at || step.started_at || atIso),
      next_started_at: String(body.next_started_at || completedAt),
      duration_sec: durationSec,
    };
  }

  if (action === "start" || action === "start_step" || action === "start_steps") {
    return {
      ...body,
      started_at: String(body.started_at || atIso),
    };
  }

  if (action === "resume") {
    if (typeof body.total_paused_sec === "number") {
      return {
        ...body,
        resumed_at: String(body.resumed_at || atIso),
      };
    }
    const pausedAt = job.paused_at ? Date.parse(job.paused_at) : NaN;
    const extra = Number.isFinite(pausedAt)
      ? Math.max(0, Math.floor((at.getTime() - pausedAt) / 1000))
      : 0;
    return {
      ...body,
      total_paused_sec: Math.max(0, Number(job.total_paused_sec || 0) + extra),
      resumed_at: atIso,
    };
  }

  if (action === "pause" || action === "complete") {
    const snapshots =
      Array.isArray(body.step_snapshots) && body.step_snapshots.length
        ? body.step_snapshots
        : job.steps
            .filter((s) => s.status === "in_progress")
            .map((s) => ({
              id: s.id,
              duration_sec: freezeStepDuration(s, at),
              started_at: action === "pause" ? "" : s.started_at,
            }));
    return {
      ...body,
      paused_at: action === "pause" ? String(body.paused_at || atIso) : body.paused_at,
      completed_at:
        action === "complete" ? String(body.completed_at || atIso) : body.completed_at,
      step_snapshots: snapshots,
    };
  }

  return body;
}

export function prepareJobCreateBody(
  qc: QueryClient | null,
  body: JsonRecord
): JsonRecord {
  const templateId = String(body.template_id || "");
  const template = qc && templateId ? findTemplate(qc, templateId) : undefined;
  const tplDefs = template ? templateStepDefs(template) : [];
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return tplDefs.length ? { ...body, steps: tplDefs } : body;
  }
  const steps = (body.steps as JobStepPayload[]).map((step, i) => ({
    ...step,
    std_minutes: Number(step.std_minutes || tplDefs[i]?.std_minutes || 0),
    name: step.name || tplDefs[i]?.name || step.name,
  }));
  return { ...body, steps };
}

export function applyOptimisticMutation(
  qc: QueryClient,
  method: string,
  url: string,
  rawBody: string | null
): unknown {
  const path = pathOf(url);
  const body = parseBody(rawBody);
  const verb = method.toUpperCase();

  if (verb === "POST" && path === "/api/jobs") {
    const created = { id: String(body.id || ""), queued: true };
    patchDashboard(qc, (data) => createJobOptimistic(qc, data, body));
    return created;
  }

  const jobPatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobPatch) {
    const jobId = jobPatch[1];
    if (verb === "PATCH") {
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => {
          const unit = data.units.find((u) => u.id === String(body.unit_id || job.unit_id));
          const next = {
            ...job,
            title: String(body.title || job.title),
            description:
              body.description != null ? String(body.description) : job.description,
            estimated_minutes:
              Number(body.estimated_minutes || job.estimated_minutes) ||
              job.estimated_minutes,
            unit_id: unit?.id || job.unit_id,
            unit: unit ? unitLabel(unit) : job.unit,
          };
          if (Array.isArray(body.steps) && ["queued", "assigned"].includes(job.status)) {
            const defs = (body.steps as Array<string | JobStepPayload>).map((s, i) => {
              if (typeof s === "string") {
                return {
                  id: newEntityId("S"),
                  name: s,
                  std_minutes: job.steps[i]?.std_minutes || 0,
                };
              }
              return {
                id: s.id || newEntityId("S"),
                name: s.name,
                std_minutes: Number(s.std_minutes || job.steps[i]?.std_minutes || 0),
              };
            });
            next.steps = toJobSteps(jobId, defs);
          }
          return next;
        })
      );
      return { id: jobId, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) => ({
        ...data,
        jobs: data.jobs.filter((j) => j.id !== jobId),
        technicians: data.technicians.map((t) =>
          t.current_job_id === jobId
            ? { ...t, status: "available" as TechnicianStatus, current_job_id: "" }
            : t
        ),
      }));
      return { ok: true, queued: true };
    }
  }

  const jobAction = path.match(/^\/api\/jobs\/([^/]+)\/action$/);
  if (verb === "POST" && jobAction) {
    patchDashboard(qc, (data) => applyJobAction(data, jobAction[1], body));
    return { id: jobAction[1], queued: true, action: body.action };
  }

  const handoverCreate = path.match(/^\/api\/jobs\/([^/]+)\/handovers$/);
  if (verb === "POST" && handoverCreate) {
    const jobId = handoverCreate[1];
    const row: JobHandover = {
      id: String(body.id || newEntityId("H")),
      job_id: jobId,
      order: 0,
      title: String(body.title || ""),
      done: body.done ? "1" : "0",
      note: String(body.note || ""),
      user_id: "",
      user_name: "",
      updated_at: nowIso(),
    };
    patchDashboard(qc, (data) =>
      mapJob(data, jobId, (job) => ({
        ...job,
        handovers: [
          ...job.handovers,
          { ...row, order: job.handovers.length + 1 },
        ],
      }))
    );
    return { ...row, queued: true };
  }

  const handoverItem = path.match(/^\/api\/jobs\/([^/]+)\/handovers\/([^/]+)$/);
  if (handoverItem) {
    const [, jobId, handoverId] = handoverItem;
    if (verb === "PATCH") {
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => ({
          ...job,
          handovers: job.handovers.map((h) =>
            h.id === handoverId
              ? {
                  ...h,
                  title: body.title != null ? String(body.title) : h.title,
                  note: body.note != null ? String(body.note) : h.note,
                  done:
                    typeof body.done === "boolean" ? (body.done ? "1" : "0") : h.done,
                  updated_at: nowIso(),
                }
              : h
          ),
        }))
      );
      return { id: handoverId, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => ({
          ...job,
          handovers: job.handovers
            .filter((h) => h.id !== handoverId)
            .map((h, i) => ({ ...h, order: i + 1 })),
        }))
      );
      return { ok: true, queued: true };
    }
  }

  const loanCreate = path.match(/^\/api\/jobs\/([^/]+)\/part-loans$/);
  if (verb === "POST" && loanCreate) {
    const jobId = loanCreate[1];
    const row: JobPartLoan = {
      id: String(body.id || newEntityId("L")),
      job_id: jobId,
      order: 0,
      part_name: String(body.part_name || ""),
      status: body.status === "closed" ? "closed" : "open",
      note: String(body.note || ""),
      user_id: "",
      user_name: "",
      updated_at: nowIso(),
    };
    patchDashboard(qc, (data) =>
      mapJob(data, jobId, (job) => ({
        ...job,
        part_loans: [...job.part_loans, { ...row, order: job.part_loans.length + 1 }],
      }))
    );
    return { ...row, queued: true };
  }

  const loanItem = path.match(/^\/api\/jobs\/([^/]+)\/part-loans\/([^/]+)$/);
  if (loanItem) {
    const [, jobId, loanId] = loanItem;
    if (verb === "PATCH") {
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => ({
          ...job,
          part_loans: job.part_loans.map((p) =>
            p.id === loanId
              ? {
                  ...p,
                  part_name:
                    body.part_name != null ? String(body.part_name) : p.part_name,
                  note: body.note != null ? String(body.note) : p.note,
                  status:
                    body.status === "closed" || body.status === "open"
                      ? (body.status as PartLoanStatus)
                      : p.status,
                  updated_at: nowIso(),
                }
              : p
          ),
        }))
      );
      return { id: loanId, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => ({
          ...job,
          part_loans: job.part_loans
            .filter((p) => p.id !== loanId)
            .map((p, i) => ({ ...p, order: i + 1 })),
        }))
      );
      return { ok: true, queued: true };
    }
  }

  if (verb === "POST" && path === "/api/units") {
    const unit: Unit = {
      id: String(body.id || newEntityId("U")),
      code: String(body.code || "").trim().toUpperCase(),
      name: String(body.name || "").trim(),
      serial_number: String(body.serial_number || "").trim(),
      active: "1",
    };
    patchDashboard(qc, (data) =>
      data.units.some((u) => u.id === unit.id)
        ? data
        : { ...data, units: [...data.units, unit] }
    );
    return { ...unit, queued: true };
  }

  const unitItem = path.match(/^\/api\/units\/([^/]+)$/);
  if (unitItem) {
    const unitId = unitItem[1];
    if (verb === "PATCH") {
      patchDashboard(qc, (data) => ({
        ...data,
        units: data.units.map((u) =>
          u.id === unitId
            ? {
                ...u,
                code: String(body.code || u.code).trim().toUpperCase(),
                name: String(body.name || u.name).trim(),
                serial_number: String(body.serial_number || u.serial_number).trim(),
                active:
                  body.active === "0" || body.active === "1" ? String(body.active) : u.active,
              }
            : u
        ),
      }));
      return { id: unitId, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) => ({
        ...data,
        units: data.units.filter((u) => u.id !== unitId),
      }));
      return { ok: true, queued: true };
    }
  }

  if (verb === "POST" && path === "/api/technicians") {
    const tech: Technician = {
      id: String(body.id || newEntityId("T")),
      name: String(body.name || "").trim(),
      sn: String(body.sn || body.skill || "").trim(),
      phone: String(body.phone || "").trim(),
      status: body.status === "offline" ? "offline" : "available",
      current_job_id: "",
    };
    patchDashboard(qc, (data) =>
      data.technicians.some((t) => t.id === tech.id)
        ? data
        : { ...data, technicians: [...data.technicians, tech] }
    );
    return { ...tech, queued: true };
  }

  const techItem = path.match(/^\/api\/technicians\/([^/]+)$/);
  if (techItem) {
    const techId = techItem[1];
    if (verb === "PATCH") {
      patchDashboard(qc, (data) => ({
        ...data,
        technicians: data.technicians.map((t) =>
          t.id === techId
            ? {
                ...t,
                name: body.name != null ? String(body.name) : t.name,
                sn: body.sn != null ? String(body.sn) : t.sn,
                phone: body.phone != null ? String(body.phone) : t.phone,
                status:
                  body.status === "available" || body.status === "offline"
                    ? (body.status as TechnicianStatus)
                    : t.status,
              }
            : t
        ),
      }));
      return { id: techId, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) => ({
        ...data,
        technicians: data.technicians.filter((t) => t.id !== techId),
      }));
      return { ok: true, queued: true };
    }
  }

  if (verb === "POST" && path === "/api/attendance") {
    const row: Attendance = {
      id: String(body.id || newEntityId("A")),
      date: String(body.date || ""),
      technician_id: String(body.technician_id || ""),
      technician_name: String(body.technician_name || ""),
      pernr: String(body.pernr || ""),
      status: (String(body.status || "hadir") as AttendanceStatus) || "hadir",
      dws: String(body.dws || ""),
      check_in: String(body.check_in || ""),
      check_out: String(body.check_out || ""),
      absence: String(body.absence || ""),
      note: String(body.note || ""),
    };
    patchDashboard(qc, (data) => ({
      ...data,
      attendance: [row, ...data.attendance.filter((a) => a.id !== row.id)],
    }));
    return { ...row, queued: true };
  }

  const attItem = path.match(/^\/api\/attendance\/([^/]+)$/);
  if (attItem) {
    const id = attItem[1];
    if (verb === "PATCH") {
      patchDashboard(qc, (data) => ({
        ...data,
        attendance: data.attendance.map((a) =>
          a.id === id
            ? {
                ...a,
                date: body.date != null ? String(body.date) : a.date,
                technician_id:
                  body.technician_id != null ? String(body.technician_id) : a.technician_id,
                technician_name:
                  body.technician_name != null
                    ? String(body.technician_name)
                    : a.technician_name,
                pernr: body.pernr != null ? String(body.pernr) : a.pernr,
                status: body.status
                  ? (String(body.status) as AttendanceStatus)
                  : a.status,
                dws: body.dws != null ? String(body.dws) : a.dws,
                check_in: body.check_in != null ? String(body.check_in) : a.check_in,
                check_out: body.check_out != null ? String(body.check_out) : a.check_out,
                absence: body.absence != null ? String(body.absence) : a.absence,
                note: body.note != null ? String(body.note) : a.note,
              }
            : a
        ),
      }));
      return { id, queued: true };
    }
    if (verb === "DELETE") {
      patchDashboard(qc, (data) => ({
        ...data,
        attendance: data.attendance.filter((a) => a.id !== id),
      }));
      return { ok: true, queued: true };
    }
  }

  if (verb === "POST" && path === "/api/job-templates") {
    const steps = Array.isArray(body.steps) ? body.steps : [];
    const template: JobTemplate = {
      id: String(body.id || newEntityId("tpl")),
      category: (["engine", "non_engine", "goh"].includes(String(body.category))
        ? body.category
        : "engine") as JobTemplateCategory,
      name: String(body.name || ""),
      active: body.active === "0" ? "0" : "1",
      std_minutes: steps.reduce(
        (sum: number, s: { std_minutes?: number }) =>
          sum + Number(s?.std_minutes || 0),
        0
      ),
      steps: steps.map((s: JsonRecord, i: number) => ({
        id: String(s.id || newEntityId("TS")),
        template_id: String(body.id || ""),
        phase: String(s.phase || ""),
        name: String(s.name || ""),
        order: Number(s.order || i + 1),
        man_power: Number(s.man_power || 1),
        std_minutes: Number(s.std_minutes || 0),
      })),
    };
    patchTemplates(qc, (list) =>
      list.some((t) => t.id === template.id) ? list : [...list, template]
    );
    return { ...template, queued: true };
  }

  const tplItem = path.match(/^\/api\/job-templates\/([^/]+)$/);
  if (tplItem) {
    const id = tplItem[1];
    if (verb === "PATCH") {
      patchTemplates(qc, (list) =>
        list.map((t) =>
          t.id === id
            ? {
                ...t,
                name: body.name != null ? String(body.name) : t.name,
                category: (body.category as JobTemplateCategory) || t.category,
                active:
                  body.active === "0" || body.active === "1"
                    ? String(body.active)
                    : t.active,
              }
            : t
        )
      );
      return { id, queued: true };
    }
    if (verb === "DELETE") {
      patchTemplates(qc, (list) =>
        list.map((t) => (t.id === id ? { ...t, active: "0" } : t))
      );
      return { ok: true, queued: true };
    }
  }

  return { ok: true, queued: true };
}
