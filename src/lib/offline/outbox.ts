import { idbDelete, idbGetAll, idbPut, OUTBOX_STORE } from "./db";
import { newEntityId } from "./ids";

export type OutboxStatus = "pending" | "syncing" | "error";

export type OutboxItem = {
  id: string;
  method: string;
  url: string;
  body: string | null;
  createdAt: string;
  status: OutboxStatus;
  error?: string;
  entityKey?: string;
};

type Listener = () => void;

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function entityKeyFrom(url: string): string {
  const path = url.split("?")[0];
  const job = path.match(/^\/api\/jobs\/([^/]+)/);
  if (job) return `job:${job[1]}`;
  const unit = path.match(/^\/api\/units\/([^/]+)/);
  if (unit) return `unit:${unit[1]}`;
  const tech = path.match(/^\/api\/technicians\/([^/]+)/);
  if (tech) return `technician:${tech[1]}`;
  const att = path.match(/^\/api\/attendance\/([^/]+)/);
  if (att) return `attendance:${att[1]}`;
  const tpl = path.match(/^\/api\/job-templates\/([^/]+)/);
  if (tpl) return `template:${tpl[1]}`;
  if (path === "/api/jobs") return "job:create";
  if (path === "/api/units") return "unit:create";
  if (path === "/api/technicians") return "technician:create";
  if (path === "/api/attendance") return "attendance:create";
  if (path === "/api/job-templates") return "template:create";
  return path;
}

function parseOutboxBody(raw: string | null): Record<string, unknown> | null {
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

/** Drop stale pending/error rows superseded by the same job action. */
async function dedupeJobActionOutbox(url: string, body: string | null) {
  const path = url.split("?")[0];
  const jobAction = path.match(/^\/api\/jobs\/([^/]+)\/action$/);
  if (!jobAction) return;
  const nextBody = parseOutboxBody(body);
  if (!nextBody) return;
  const nextAction = String(nextBody.action || "");
  if (!nextAction) return;
  const nextStepId = nextBody.step_id ? String(nextBody.step_id) : "";

  const existing = await listOutbox();
  for (const row of existing) {
    if (row.status !== "pending" && row.status !== "error") continue;
    if (row.url.split("?")[0] !== path) continue;
    const prevBody = parseOutboxBody(row.body);
    if (!prevBody) continue;
    if (String(prevBody.action || "") !== nextAction) continue;
    if (
      nextAction === "complete_step" &&
      nextStepId &&
      String(prevBody.step_id || "") !== nextStepId
    ) {
      continue;
    }
    if (
      (nextAction === "start_step" || nextAction === "start_steps") &&
      nextStepId &&
      String(prevBody.step_id || "") !== nextStepId
    ) {
      continue;
    }
    await removeOutboxItem(row.id);
  }
}

export async function enqueueMutation(input: {
  method: string;
  url: string;
  body?: string | null;
  entityKey?: string;
}): Promise<OutboxItem> {
  await dedupeJobActionOutbox(input.url, input.body ?? null);
  const item: OutboxItem = {
    id: newEntityId("ox"),
    method: input.method.toUpperCase(),
    url: input.url,
    body: input.body ?? null,
    createdAt: new Date().toISOString(),
    status: "pending",
    entityKey: input.entityKey || entityKeyFrom(input.url),
  };
  await idbPut(OUTBOX_STORE, item);
  notify();
  return item;
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const rows = await idbGetAll<OutboxItem>(OUTBOX_STORE);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countOutbox(): Promise<number> {
  const rows = await listOutbox();
  return rows.filter((r) => r.status !== "syncing").length;
}

export async function updateOutboxItem(
  id: string,
  patch: Partial<OutboxItem>
): Promise<void> {
  const rows = await listOutbox();
  const current = rows.find((r) => r.id === id);
  if (!current) return;
  await idbPut(OUTBOX_STORE, { ...current, ...patch, id });
  notify();
}

export async function removeOutboxItem(id: string): Promise<void> {
  await idbDelete(OUTBOX_STORE, id);
  notify();
}

export function pendingEntityKeys(items: OutboxItem[]): Set<string> {
  return new Set(
    items
      .map((item) => item.entityKey)
      .filter((key): key is string => Boolean(key))
  );
}
