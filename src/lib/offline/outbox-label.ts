import type { MessageKey } from "@/i18n/messages";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardData, JobWithDetails } from "@/lib/types";
import { readBoardSnapshot } from "./board-snapshot";
import { type OutboxItem } from "./outbox";
import { getQueryClient } from "./query-bridge";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>
) => string;

export type OutboxChangeLine = {
  id: string;
  title: string;
  meta: string;
  status: OutboxItem["status"];
  error: string;
};

const ACTION_KEY: Record<string, MessageKey> = {
  assign: "offline.act.assign",
  delegate: "offline.act.delegate",
  undelegate: "offline.act.undelegate",
  start: "offline.act.start",
  pause: "offline.act.pause",
  resume: "offline.act.resume",
  start_step: "offline.act.start_step",
  start_steps: "offline.act.start_steps",
  complete_step: "offline.act.complete_step",
  set_step_technicians: "offline.act.set_step_technicians",
  set_step_note: "offline.act.set_step_note",
  edit_step_note: "offline.act.edit_step_note",
  complete: "offline.act.complete",
  cancel: "offline.act.cancel",
  reopen: "offline.act.reopen",
};

function parseBody(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function clip(value: unknown, max = 48): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function collectJobs(): JobWithDetails[] {
  const found = new Map<string, JobWithDetails>();
  const add = (list?: JobWithDetails[]) => {
    for (const job of list || []) {
      if (job?.id) found.set(job.id, job);
    }
  };
  const dash = readBoardSnapshot()?.dashboard;
  add(dash?.jobs);
  add(dash?.completed_jobs);
  add(dash?.cancelled_jobs);
  const qc = getQueryClient();
  const live = qc?.getQueryData<DashboardData>(queryKeys.dashboard);
  add(live?.jobs);
  add(live?.completed_jobs);
  add(live?.cancelled_jobs);
  if (qc) {
    for (const query of qc.getQueryCache().findAll({
      queryKey: queryKeys.board.all,
    })) {
      const data = query.state.data as { items?: JobWithDetails[] } | undefined;
      add(data?.items);
    }
  }
  return [...found.values()];
}

function jobFromPath(path: string, jobs: JobWithDetails[]): JobWithDetails | undefined {
  const id = path.match(/^\/api\/jobs\/([^/]+)/)?.[1];
  if (!id) return undefined;
  return jobs.find((job) => job.id === decodeURIComponent(id));
}

function stepLabel(
  job: JobWithDetails | undefined,
  stepId: string,
  t: Translate
): string {
  if (!stepId || !job) return "";
  const step = job.steps?.find((row) => row.id === stepId);
  if (!step) return "";
  const name = `${step.order}. ${step.name}`.trim();
  return name ? t("offline.stepLine", { step: name }) : "";
}

function actionTitle(
  action: string,
  body: Record<string, unknown>,
  t: Translate
): string {
  if (action === "set_step_photo") {
    const photos = Array.isArray(body.photos) ? body.photos.length : 0;
    const removed = Array.isArray(body.remove_photo_ids)
      ? body.remove_photo_ids.length
      : 0;
    if (photos > 1) return t("offline.act.set_step_photo_n", { count: photos });
    if (photos === 1) return t("offline.act.set_step_photo");
    if (removed > 0) return t("offline.act.remove_step_photo");
    return t("offline.act.set_step_photo");
  }
  const key = ACTION_KEY[action];
  return key ? t(key) : action.replaceAll("_", " ");
}

export function describeOutboxItems(
  items: OutboxItem[],
  t: Translate
): OutboxChangeLine[] {
  const jobs = collectJobs();
  return items.map((item) => {
    const path = item.url.split("?")[0];
    const body = parseBody(item.body);
    const job = jobFromPath(path, jobs);
    const action = String(body?.action || "");
    const stepId = String(body?.step_id || "");
    const parts: string[] = [];

    let title = "";
    if (action) {
      title = actionTitle(action, body || {}, t);
      const step = stepLabel(job, stepId, t);
      if (step) parts.push(step);
      const note = clip(body?.note);
      if (
        note &&
        (action === "set_step_note" || action === "edit_step_note")
      ) {
        parts.push(note);
      }
      if (action === "delegate") {
        const snap = body?.delegate_user;
        const name =
          snap && typeof snap === "object"
            ? clip(
                (snap as { name?: string; username?: string }).name ||
                  (snap as { username?: string }).username
              )
            : "";
        if (name) parts.push(name);
      }
    } else if (path === "/api/jobs" && item.method === "POST") {
      title = t("offline.act.create_job");
    } else if (/^\/api\/jobs\/[^/]+$/.test(path) && item.method === "PATCH") {
      title = t("offline.act.update_job");
    } else if (/^\/api\/jobs\/[^/]+$/.test(path) && item.method === "DELETE") {
      title = t("offline.act.delete_job");
    } else if (path.includes("/handovers")) {
      title = t("offline.act.handover");
      const handover = clip(body?.title);
      if (handover) parts.push(handover);
    } else if (path.includes("/part-loans")) {
      title = t("offline.act.part_loan");
      const loan = clip(body?.part_name || body?.title || body?.note);
      if (loan) parts.push(loan);
    } else if (item.method === "POST") {
      title = t("offline.act.create");
      const name = clip(body?.title || body?.name);
      if (name) parts.push(name);
    } else if (item.method === "PATCH" || item.method === "PUT") {
      title = t("offline.act.update");
    } else if (item.method === "DELETE") {
      title = t("offline.act.delete");
    } else {
      title = t("offline.act.generic", { method: item.method, path });
    }

    if (job?.title && !parts.includes(job.title)) parts.push(job.title);

    return {
      id: item.id,
      title,
      meta: parts.filter(Boolean).join(" · "),
      status: item.status,
      error: item.status === "error" ? clip(item.error, 80) : "",
    };
  });
}
