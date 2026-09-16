import type { QueryClient } from "@tanstack/react-query";
import type { JobListSection, PaginatedResult } from "@/lib/board-list";
import { queryKeys } from "@/lib/query-keys";
import type {
  AppUserPublic,
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
import { normalizeJobPriority } from "@/lib/types";
import { attachStepPhotoUrl, parseStepPhotos } from "@/lib/step-photo-url";
import { withAppendedStepNote, withUpdatedStepNote } from "@/lib/step-notes";
import { cacheStepPhotoPreviews } from "@/lib/offline/step-photo-preview";
import { readBoardSnapshot } from "@/lib/offline/board-snapshot";
import { newEntityId, type JobStepPayload, type JsonRecord } from "./ids";
import {
  assignedTechnicianIds,
  mergeInProgressStepTechnicians,
  parseStepTechnicianIds,
  selectedStepTechnicianIds,
  stampEmptyTechnicianIds,
} from "@/lib/step-technicians";

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

type BoardJobsQueryMeta = {
  section: JobListSection | "slider";
};

function forEachBoardJobsQuery(
  qc: QueryClient,
  fn: (
    key: readonly unknown[],
    data: PaginatedResult<JobWithDetails>,
    meta: BoardJobsQueryMeta
  ) => void
) {
  for (const query of qc.getQueryCache().findAll({ queryKey: queryKeys.board.all })) {
    const key = query.queryKey;
    if (key[0] !== "board" || key[1] !== "jobs") continue;
    const data = query.state.data as PaginatedResult<JobWithDetails> | undefined;
    if (!data) continue;
    const section =
      key[3] === "slider"
        ? ("slider" as const)
        : (key[2] as JobListSection);
    if (
      section !== "slider" &&
      !["active", "queue", "done", "cancelled"].includes(section)
    ) {
      continue;
    }
    fn(key, data, { section });
  }
}

function boardQueryPriorityFilter(key: readonly unknown[]): string {
  if (key[3] === "slider") return normalizeJobPriority(key[6]);
  return normalizeJobPriority(key[8]);
}

function jobMatchesBoardPriorityFilter(
  job: JobWithDetails,
  key: readonly unknown[]
): boolean {
  const wanted = boardQueryPriorityFilter(key);
  if (!wanted) return true;
  return normalizeJobPriority(job.priority) === wanted;
}

function findJobInBoardCaches(
  qc: QueryClient,
  jobId: string
): JobWithDetails | undefined {
  let found: JobWithDetails | undefined;
  forEachBoardJobsQuery(qc, (_key, data) => {
    if (!found) found = data.items.find((j) => j.id === jobId);
  });
  return found;
}

const EMPTY_DASHBOARD: DashboardData = {
  technicians: [],
  units: [],
  jobs: [],
  completed_jobs: [],
  cancelled_jobs: [],
  attendance: [],
  summary: {
    available: 0,
    busy: 0,
    offline: 0,
    active_jobs: 0,
    queued_jobs: 0,
    done_today: 0,
    completed_jobs: 0,
    cancelled_jobs: 0,
    avg_duration_sec: 0,
  },
};

function findJobInClient(
  qc: QueryClient,
  jobId: string
): JobWithDetails | undefined {
  return (
    findJobInBoardCaches(qc, jobId) ||
    findJob(qc.getQueryData<DashboardData>(queryKeys.dashboard) ?? EMPTY_DASHBOARD, jobId)
  );
}

function asTechnician(row: Partial<Technician> & { id: string }): Technician {
  const status: TechnicianStatus =
    row.status === "busy" || row.status === "offline" ? row.status : "available";
  return {
    id: row.id,
    name: String(row.name || "").trim() || row.id,
    sn: String(row.sn || ""),
    badge_id: String(row.badge_id || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    status,
    current_job_id: String(row.current_job_id || ""),
    superior_user_id: String(row.superior_user_id || ""),
    superior_user_name: String(row.superior_user_name || ""),
    user_id: row.user_id ? String(row.user_id) : undefined,
  };
}

function rememberTech(map: Map<string, Technician>, row?: Partial<Technician> | null) {
  const id = String(row?.id || "").trim();
  if (!id) return;
  const prev = map.get(id);
  const next = asTechnician({ ...prev, ...row, id });
  if (prev?.name && (next.name === id || !String(row?.name || "").trim())) {
    next.name = prev.name;
  }
  map.set(id, next);
}

/** Dashboard API returns technicians: []. Names live on board lists and the assign pool. */
function collectKnownTechnicians(qc: QueryClient | null): Technician[] {
  const map = new Map<string, Technician>();
  const dash = qc?.getQueryData<DashboardData>(queryKeys.dashboard);
  for (const tech of dash?.technicians || []) rememberTech(map, tech);
  if (!qc) return [...map.values()];
  for (const query of qc.getQueryCache().findAll({ queryKey: ["board", "technicians"] })) {
    const data = query.state.data as { items?: Technician[] } | undefined;
    for (const tech of data?.items || []) rememberTech(map, tech);
  }
  forEachBoardJobsQuery(qc, (_key, data) => {
    for (const job of data.items) {
      for (const tech of job.technicians || []) rememberTech(map, tech);
      for (const tech of job.technician_index || []) rememberTech(map, tech);
      if (job.technician) rememberTech(map, job.technician);
    }
  });
  return [...map.values()];
}

function userLabel(user: { name?: string; username?: string; id?: string }): string {
  return (
    String(user.name || "").trim() ||
    String(user.username || "").trim() ||
    String(user.id || "").trim()
  );
}

function rememberForeman(map: Map<string, AppUserPublic>, row?: Partial<AppUserPublic> | null) {
  const id = String(row?.id || "").trim();
  if (!id) return;
  if (row?.level && row.level !== "foreman") return;
  if (row?.active === "0") return;
  const prev = map.get(id);
  const name = String(row?.name || prev?.name || "").trim();
  const username = String(row?.username || prev?.username || name || id).trim();
  map.set(id, {
    id,
    username,
    name: name || username,
    email: String(row?.email || prev?.email || ""),
    phone: String(row?.phone || prev?.phone || ""),
    photo_name: String(row?.photo_name || prev?.photo_name || ""),
    photo_url: row?.photo_url || prev?.photo_url,
    level: "foreman",
    active: "1",
    created_at: String(row?.created_at || prev?.created_at || ""),
  });
}

/** Foremen already fetched online, plus assigners stored on cached jobs. */
export function listCachedForemen(qc: QueryClient | null): AppUserPublic[] {
  const map = new Map<string, AppUserPublic>();
  for (const user of readBoardSnapshot()?.foremen || []) rememberForeman(map, user);
  for (const user of qc?.getQueryData<AppUserPublic[]>(queryKeys.foremen) || []) {
    rememberForeman(map, user);
  }
  const addOwner = (
    id?: string,
    name?: string,
    level?: string
  ) => {
    if (level !== "foreman") return;
    rememberForeman(map, { id, name, username: name, level: "foreman", active: "1" });
  };
  const walk = (jobs?: Array<JobWithDetails | Job>) => {
    for (const job of jobs || []) {
      addOwner(job.assigned_by_user_id, job.assigned_by_user_name, job.assigned_by_user_level);
      addOwner(job.delegated_to_user_id, job.delegated_to_user_name, "foreman");
    }
  };
  const dash = qc?.getQueryData<DashboardData>(queryKeys.dashboard);
  walk(dash?.jobs);
  walk(dash?.completed_jobs);
  walk(dash?.cancelled_jobs);
  if (qc) {
    forEachBoardJobsQuery(qc, (_key, data) => walk(data.items));
  }
  return [...map.values()].sort((a, b) =>
    userLabel(a).localeCompare(userLabel(b), "id")
  );
}

function delegateUserFromBody(
  body: JsonRecord
): { id: string; name: string; username: string } | null {
  const raw = body.delegate_user;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id || "").trim();
  if (!id) return null;
  const name = String(rec.name || rec.username || "").trim();
  return { id, name, username: String(rec.username || name || id) };
}

function techniciansFromBody(body: JsonRecord): Technician[] {
  if (!Array.isArray(body.technicians)) return [];
  const out: Technician[] = [];
  for (const row of body.technicians) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id = String(rec.id || "").trim();
    if (!id) continue;
    out.push(
      asTechnician({
        id,
        name: String(rec.name || ""),
        sn: String(rec.sn || ""),
        badge_id: String(rec.badge_id || ""),
        email: String(rec.email || ""),
        phone: String(rec.phone || ""),
        status:
          rec.status === "busy" || rec.status === "offline"
            ? rec.status
            : "available",
        current_job_id: String(rec.current_job_id || ""),
        superior_user_id: String(rec.superior_user_id || ""),
        superior_user_name: String(rec.superior_user_name || ""),
      })
    );
  }
  return out;
}

function prependTechnicianList(qc: QueryClient, tech: Technician) {
  for (const query of qc.getQueryCache().findAll({ queryKey: ["board", "technicians"] })) {
    const key = query.queryKey;
    const bucket = String(key[2] || "");
    if (bucket !== "available" && bucket !== "assign") continue;
    const data = query.state.data as PaginatedResult<Technician> | undefined;
    if (!data?.items || data.items.some((row) => row.id === tech.id)) continue;
    const q = (bucket === "assign" ? String(key[3] || "") : String(key[5] || ""))
      .trim()
      .toLowerCase();
    if (
      q &&
      !tech.name.toLowerCase().includes(q) &&
      !tech.sn.toLowerCase().includes(q) &&
      !tech.badge_id.toLowerCase().includes(q)
    ) {
      continue;
    }
    qc.setQueryData(key, {
      ...data,
      items: [tech, ...data.items],
      total: data.total + 1,
    });
  }
}

function patchJobInBoardCaches(
  qc: QueryClient,
  jobId: string,
  updater: (job: JobWithDetails) => JobWithDetails
) {
  forEachBoardJobsQuery(qc, (key, data) => {
    const idx = data.items.findIndex((j) => j.id === jobId);
    if (idx < 0) return;
    const nextJob = enrich(updater(data.items[idx]));
    if (!jobMatchesBoardPriorityFilter(nextJob, key)) {
      qc.setQueryData(key, {
        ...data,
        items: data.items.filter((j) => j.id !== jobId),
        total: Math.max(0, data.total - 1),
      });
      return;
    }
    const items = data.items.slice();
    items[idx] = nextJob;
    qc.setQueryData(key, { ...data, items });
  });
}

function removeJobFromBoardCaches(qc: QueryClient, jobId: string) {
  forEachBoardJobsQuery(qc, (key, data) => {
    if (!data.items.some((j) => j.id === jobId)) return;
    qc.setQueryData(key, {
      ...data,
      items: data.items.filter((j) => j.id !== jobId),
      total: Math.max(0, data.total - 1),
    });
  });
}

function prependJobToBoardCaches(
  qc: QueryClient,
  job: JobWithDetails,
  target: JobListSection | "active-slider"
) {
  forEachBoardJobsQuery(qc, (key, data, meta) => {
    const match =
      target === "active-slider"
        ? meta.section === "slider" || meta.section === "active"
        : meta.section === target ||
          (target === "active" && meta.section === "slider");
    if (!match) return;
    if (!jobMatchesBoardPriorityFilter(job, key)) return;
    const without = data.items.filter((j) => j.id !== job.id);
    const had = without.length !== data.items.length;
    qc.setQueryData(key, {
      ...data,
      items: [enrich(job), ...without],
      total: had ? data.total : data.total + 1,
    });
  });
}

function buildSyntheticDashboard(
  dashboard: DashboardData | undefined,
  job: JobWithDetails | undefined
): DashboardData {
  const base: DashboardData = {
    technicians: dashboard?.technicians ?? [],
    units: dashboard?.units ?? [],
    jobs: [],
    completed_jobs: [],
    cancelled_jobs: [],
    attendance: dashboard?.attendance ?? [],
    summary: dashboard?.summary ?? EMPTY_DASHBOARD.summary,
  };
  if (!job) return base;
  if (job.status === "cancelled") return { ...base, cancelled_jobs: [job] };
  if (job.status === "done") return { ...base, completed_jobs: [job] };
  return { ...base, jobs: [job] };
}

function applyJobActionToCaches(
  qc: QueryClient,
  jobId: string,
  body: JsonRecord
) {
  const job = findJobInClient(qc, jobId);
  const dashboard = qc.getQueryData<DashboardData>(queryKeys.dashboard);
  const known = new Map<string, Technician>();
  for (const tech of collectKnownTechnicians(qc)) rememberTech(known, tech);
  for (const tech of techniciansFromBody(body)) rememberTech(known, tech);
  const after = applyJobAction(
    buildSyntheticDashboard(
      dashboard
        ? { ...dashboard, technicians: [...known.values()] }
        : { ...EMPTY_DASHBOARD, technicians: [...known.values()] },
      job
    ),
    jobId,
    body
  );
  const action = String(body.action || "");

  patchDashboard(qc, (data) => ({
    ...data,
    summary: after.summary,
    technicians: after.technicians.length ? after.technicians : data.technicians,
  }));

  if (!job) return;

  const updated =
    after.jobs.find((j) => j.id === jobId) ||
    after.completed_jobs.find((j) => j.id === jobId) ||
    after.cancelled_jobs.find((j) => j.id === jobId);

  if (action === "complete") {
    removeJobFromBoardCaches(qc, jobId);
    if (updated) prependJobToBoardCaches(qc, updated, "done");
    return;
  }
  if (action === "cancel") {
    removeJobFromBoardCaches(qc, jobId);
    if (updated) prependJobToBoardCaches(qc, updated, "cancelled");
    return;
  }
  if (action === "reopen" && updated) {
    removeJobFromBoardCaches(qc, jobId);
    const target: JobListSection | "active-slider" =
      updated.status === "in_progress" || updated.status === "paused"
        ? "active-slider"
        : "queue";
    prependJobToBoardCaches(qc, updated, target);
    return;
  }
  if (updated) {
    patchJobInBoardCaches(qc, jobId, () => updated);
  }
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

function applyPhotoFromBody(step: JobStep, body: JsonRecord): JobStep {
  const incoming = Array.isArray(body.photos)
    ? (body.photos as JsonRecord[])
    : String(body.photo_base64 || "").trim()
      ? [body]
      : [];
  const removeIds = new Set(
    (Array.isArray(body.remove_photo_ids) ? body.remove_photo_ids : []).map(
      (id) => String(id || "")
    )
  );
  let current = parseStepPhotos(step.photos, step.photo_name).filter(
    (p) => !removeIds.has(p.id)
  );
  const previews: string[] = [];
  incoming.forEach((item, i) => {
    const raw = String(item.photo_base64 || "").trim();
    if (!raw) return;
    const mime = String(item.photo_mime || "image/jpeg").trim() || "image/jpeg";
    const thumb = String(item.thumb_base64 || "").trim();
    previews.push(
      thumb ? `data:image/jpeg;base64,${thumb}` : `data:${mime};base64,${raw}`
    );
    current.push({
      id: `${step.id}-ox-${current.length}-${i}`,
      name: String(item.photo_name || `${step.id}.jpg`),
    });
  });
  cacheStepPhotoPreviews(step.id, previews);
  return attachStepPhotoUrl({
    ...step,
    photos: current,
    photo_name: current[0]?.name || "",
  });
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
    technician_ids: [],
    note: "",
    photo_name: "",
    photo_url: "",
    photos: [],
  }));
}

function emptyJob(partial: Partial<Job> & Pick<Job, "id" | "title">): JobWithDetails {
  const job: JobWithDetails = {
    id: partial.id,
    title: partial.title,
    priority: normalizeJobPriority(partial.priority),
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
    const known = new Map<string, Technician>();
    for (const tech of data.technicians) rememberTech(known, tech);
    for (const tech of job?.technicians || []) rememberTech(known, tech);
    for (const tech of job?.technician_index || []) rememberTech(known, tech);
    if (job?.technician) rememberTech(known, job.technician);
    for (const tech of techniciansFromBody(body)) rememberTech(known, tech);
    const selected = ids
      .map((id) => known.get(id))
      .filter((t): t is Technician => Boolean(t));
    if (!selected.length || !job) return data;
    const selectedIds = new Set(selected.map((t) => t.id));
    const previousAssignedIds = assignedTechnicianIds(job);
    const nextTechIds = selected.map((t) => t.id);
    const nextSteps =
      job.status === "in_progress" || job.status === "paused"
        ? job.steps.map((s) => {
            if (s.status === "in_progress") {
              return {
                ...s,
                technician_ids: mergeInProgressStepTechnicians(
                  s,
                  previousAssignedIds,
                  nextTechIds
                ),
              };
            }
            if (s.status === "done") {
              const stored = parseStepTechnicianIds(s.technician_ids);
              return stored.length
                ? s
                : { ...s, technician_ids: [...previousAssignedIds] };
            }
            return s;
          })
        : job.steps;
    const indexById = new Map<string, Technician>();
    for (const t of job.technician_index || []) {
      if (t?.id) indexById.set(t.id, t);
    }
    for (const t of job.technicians || []) {
      if (t?.id) indexById.set(t.id, t);
    }
    for (const t of selected) indexById.set(t.id, t);
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
              technician_index: [...indexById.values()],
              steps: nextSteps,
            })
      ),
    };
  }

  if (action === "delegate") {
    if (!job) return data;
    const targetId = String(body.delegate_user_id || "").trim();
    if (!targetId) return data;
    const snap = delegateUserFromBody(body);
    const known = listCachedForemen(null).find((user) => user.id === targetId);
    const name =
      (snap?.id === targetId ? snap.name : "") ||
      known?.name ||
      known?.username ||
      String(body.delegate_user_name || "").trim() ||
      targetId;
    return mapJob(data, jobId, (j) => ({
      ...j,
      delegated_to_user_id: targetId,
      delegated_to_user_name: name,
      delegated_at: String(body.delegated_at || nowIso()),
      delegated_by_user_id: String(body.delegated_by_user_id || ""),
    }));
  }

  if (action === "undelegate") {
    if (!job) return data;
    return mapJob(data, jobId, (j) => ({
      ...j,
      delegated_to_user_id: "",
      delegated_to_user_name: "",
      delegated_at: "",
      delegated_by_user_id: "",
    }));
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
                    ? {
                        ...s,
                        status: "in_progress",
                        started_at: clockAt,
                        technician_ids: parseStepTechnicianIds(s.technician_ids)
                          .length
                          ? s.technician_ids
                          : assignedTechnicianIds(j),
                      }
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
          ? {
              ...s,
              status: "in_progress",
              started_at: s.started_at || at,
              technician_ids: parseStepTechnicianIds(s.technician_ids).length
                ? s.technician_ids
                : assignedTechnicianIds(j),
            }
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
        let nextStep: JobStep = {
          ...s,
          status: "done" as const,
          completed_at: at,
          started_at: String(body.started_at || s.started_at || at),
          duration_sec: duration,
          technician_ids: (() => {
            try {
              return (
                selectedStepTechnicianIds(
                  body.technician_ids,
                  assignedTechnicianIds(j),
                  parseStepTechnicianIds(s.technician_ids)
                ) ?? s.technician_ids
              );
            } catch {
              return s.technician_ids;
            }
          })(),
        };
        if (String(body.note || "").trim()) {
          nextStep = withAppendedStepNote(nextStep, {
            id: String(body.note_id || ""),
            body: String(body.note),
          });
        }
        return applyPhotoFromBody(nextStep, body);
      });
      if (autoNext) {
        const next = steps.find((s) => s.status === "pending");
        if (next && !steps.some((s) => s.status === "in_progress")) {
          next.status = "in_progress";
          next.started_at = nextAt;
          stampEmptyTechnicianIds(next, assignedTechnicianIds(j));
        }
      }
      return { ...j, steps };
    });
  }

  if (action === "set_step_technicians") {
    const stepId = String(body.step_id || "");
    return mapJob(data, jobId, (j) => {
      const assignedIds = assignedTechnicianIds(j);
      let nextIds: string[] | undefined;
      try {
        nextIds = selectedStepTechnicianIds(
          body.technician_ids ?? [],
          assignedIds,
          parseStepTechnicianIds(
            j.steps.find((s) => s.id === stepId)?.technician_ids
          )
        );
      } catch {
        return j;
      }
      if (!nextIds) return j;
      return {
        ...j,
        steps: j.steps.map((s) =>
          s.id === stepId ? { ...s, technician_ids: nextIds } : s
        ),
      };
    });
  }

  if (action === "set_step_note") {
    const stepId = String(body.step_id || "");
    const note = String(body.note ?? "").trim().slice(0, 4000);
    if (!note) return data;
    return mapJob(data, jobId, (j) => ({
      ...j,
      steps: j.steps.map((s) =>
        s.id === stepId
          ? withAppendedStepNote(s, {
              id: String(body.note_id || ""),
              body: note,
              file_id: String(body.file_name || "").trim()
                ? String(body.note_id || "").trim()
                : undefined,
              file_name: String(body.file_name || "").trim()
                ? `${String(body.note_id || "").trim()}.pdf`
                : undefined,
              file_original_name: String(body.file_name || "").trim() || undefined,
            })
          : s
      ),
    }));
  }

  if (action === "edit_step_note") {
    const stepId = String(body.step_id || "");
    const noteId = String(body.note_id || "").trim();
    const note = String(body.note ?? "").trim().slice(0, 4000);
    if (!stepId || !noteId || !note) return data;
    return mapJob(data, jobId, (j) => ({
      ...j,
      steps: j.steps.map((s) =>
        s.id === stepId
          ? withUpdatedStepNote(s, {
              id: noteId,
              body: note,
              edited_by_name: String(body.edited_by_name || ""),
              edited_by_user_id: String(body.edited_by_user_id || ""),
              file_id: String(body.file_name || "").trim() ? noteId : undefined,
              file_name: String(body.file_name || "").trim()
                ? `${noteId}.pdf`
                : undefined,
              file_original_name: String(body.file_name || "").trim() || undefined,
              remove_file: body.remove_file === true,
            })
          : s
      ),
    }));
  }

  if (action === "set_step_photo") {
    const stepId = String(body.step_id || "");
    return mapJob(data, jobId, (j) => ({
      ...j,
      steps: j.steps.map((s) =>
        s.id === stepId ? applyPhotoFromBody(s, body) : s
      ),
    }));
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
      priority: normalizeJobPriority(body.priority),
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
  const job = qc ? findJobInClient(qc, match[1]) : undefined;
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

  if (action === "assign" && qc) {
    const ids = (
      Array.isArray(body.technician_ids)
        ? body.technician_ids.map(String)
        : body.technician_id
          ? [String(body.technician_id)]
          : []
    ).filter(Boolean);
    const known = new Map<string, Technician>();
    for (const tech of collectKnownTechnicians(qc)) rememberTech(known, tech);
    for (const tech of job.technicians || []) rememberTech(known, tech);
    for (const tech of techniciansFromBody(body)) rememberTech(known, tech);
    return {
      ...body,
      technicians: ids
        .map((id) => known.get(id))
        .filter((tech): tech is Technician => Boolean(tech))
        .map((tech) => asTechnician(tech)),
    };
  }

  if (action === "delegate") {
    const targetId = String(body.delegate_user_id || "").trim();
    if (!targetId) return body;
    const existing = delegateUserFromBody(body);
    const known =
      existing?.id === targetId && existing.name
        ? existing
        : listCachedForemen(qc).find((user) => user.id === targetId);
    const name = known ? userLabel(known) : existing?.name || "";
    return {
      ...body,
      delegated_at: String(body.delegated_at || atIso),
      delegate_user: {
        id: targetId,
        name,
        username: known && "username" in known ? String(known.username || name) : name,
      },
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
    let createdJob: JobWithDetails | undefined;
    patchDashboard(qc, (data) => {
      const next = createJobOptimistic(qc, data, body);
      createdJob =
        next.jobs.find((j) => j.id === String(body.id || "")) || next.jobs[0];
      return next;
    });
    if (createdJob) prependJobToBoardCaches(qc, createdJob, "queue");
    return created;
  }

  const jobPatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobPatch) {
    const jobId = jobPatch[1];
    if (verb === "PATCH") {
      const units = qc.getQueryData<DashboardData>(queryKeys.dashboard)?.units ?? [];
      patchDashboard(qc, (data) =>
        mapJob(data, jobId, (job) => {
          const unit = data.units.find((u) => u.id === String(body.unit_id || job.unit_id));
          const next = {
            ...job,
            title: String(body.title || job.title),
            priority:
              body.priority != null
                ? normalizeJobPriority(body.priority)
                : job.priority,
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
      patchJobInBoardCaches(qc, jobId, (job) => {
        const unit = units.find((u) => u.id === String(body.unit_id || job.unit_id));
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
      });
      return { id: jobId, queued: true };
    }
    if (verb === "DELETE") {
      removeJobFromBoardCaches(qc, jobId);
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
    applyJobActionToCaches(qc, jobAction[1], body);
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
      from_name: String(body.from_name || ""),
      from_user_id: String(body.from_user_id || ""),
      to_name: String(body.to_name || ""),
      to_user_id: String(body.to_user_id || ""),
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
    patchJobInBoardCaches(qc, jobId, (job) => ({
      ...job,
      handovers: [...job.handovers, { ...row, order: job.handovers.length + 1 }],
    }));
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
                  from_name:
                    body.from_name != null ? String(body.from_name) : h.from_name,
                  from_user_id:
                    body.from_user_id != null
                      ? String(body.from_user_id)
                      : h.from_user_id,
                  to_name: body.to_name != null ? String(body.to_name) : h.to_name,
                  to_user_id:
                    body.to_user_id != null
                      ? String(body.to_user_id)
                      : h.to_user_id,
                  note: body.note != null ? String(body.note) : h.note,
                  done:
                    typeof body.done === "boolean" ? (body.done ? "1" : "0") : h.done,
                  updated_at: nowIso(),
                }
              : h
          ),
        }))
      );
      patchJobInBoardCaches(qc, jobId, (job) => ({
        ...job,
        handovers: job.handovers.map((h) =>
          h.id === handoverId
            ? {
                ...h,
                title: body.title != null ? String(body.title) : h.title,
                from_name:
                  body.from_name != null ? String(body.from_name) : h.from_name,
                from_user_id:
                  body.from_user_id != null
                    ? String(body.from_user_id)
                    : h.from_user_id,
                to_name: body.to_name != null ? String(body.to_name) : h.to_name,
                to_user_id:
                  body.to_user_id != null
                    ? String(body.to_user_id)
                    : h.to_user_id,
                note: body.note != null ? String(body.note) : h.note,
                done:
                  typeof body.done === "boolean" ? (body.done ? "1" : "0") : h.done,
                updated_at: nowIso(),
              }
            : h
        ),
      }));
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
      patchJobInBoardCaches(qc, jobId, (job) => ({
        ...job,
        handovers: job.handovers
          .filter((h) => h.id !== handoverId)
          .map((h, i) => ({ ...h, order: i + 1 })),
      }));
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
    patchJobInBoardCaches(qc, jobId, (job) => ({
      ...job,
      part_loans: [...job.part_loans, { ...row, order: job.part_loans.length + 1 }],
    }));
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
      patchJobInBoardCaches(qc, jobId, (job) => ({
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
      }));
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
      patchJobInBoardCaches(qc, jobId, (job) => ({
        ...job,
        part_loans: job.part_loans
          .filter((p) => p.id !== loanId)
          .map((p, i) => ({ ...p, order: i + 1 })),
      }));
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
      badge_id: String(body.badge_id || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      status: body.status === "offline" ? "offline" : "available",
      current_job_id: "",
      superior_user_id: String(body.superior_user_id || "").trim(),
      superior_user_name: String(body.superior_user_name || "").trim(),
    };
    patchDashboard(qc, (data) =>
      data.technicians.some((t) => t.id === tech.id)
        ? data
        : { ...data, technicians: [...data.technicians, tech] }
    );
    prependTechnicianList(qc, tech);
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
                badge_id:
                  body.badge_id != null ? String(body.badge_id) : t.badge_id,
                email: body.email != null ? String(body.email) : t.email,
                phone: body.phone != null ? String(body.phone) : t.phone,
                superior_user_id:
                  body.superior_user_id != null
                    ? String(body.superior_user_id)
                    : t.superior_user_id,
                superior_user_name:
                  body.superior_user_name != null
                    ? String(body.superior_user_name)
                    : t.superior_user_name,
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
      patchTemplates(qc, (list) => list.filter((t) => t.id !== id));
      return { ok: true, queued: true };
    }
  }

  return { ok: true, queued: true };
}
