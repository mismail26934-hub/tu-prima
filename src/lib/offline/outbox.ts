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

export async function enqueueMutation(input: {
  method: string;
  url: string;
  body?: string | null;
  entityKey?: string;
}): Promise<OutboxItem> {
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
