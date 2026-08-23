import { queryKeys } from "@/lib/query-keys";
import {
  listOutbox,
  removeOutboxItem,
  updateOutboxItem,
  type OutboxItem,
} from "./outbox";
import { isBrowserOnline, isNetworkError } from "./network";
import { getQueryClient } from "./query-bridge";

export type SyncState = {
  syncing: boolean;
  pending: number;
  error: string;
  lastSyncedAt: string | null;
};

type Listener = (state: SyncState) => void;

let syncing = false;
let lastError = "";
let lastSyncedAt: string | null = null;
let pending = 0;
const listeners = new Set<Listener>();

function emit() {
  const state: SyncState = {
    syncing,
    pending,
    error: lastError,
    lastSyncedAt,
  };
  listeners.forEach((fn) => fn(state));
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  listener({
    syncing,
    pending,
    error: lastError,
    lastSyncedAt,
  });
  return () => listeners.delete(listener);
}

export function getPendingCount() {
  return pending;
}

/** Skip server GET while offline or while outbox still has writes. */
export function shouldHoldServerRefresh() {
  return !isBrowserOnline() || pending > 0;
}

export async function refreshPendingCount() {
  const items = await listOutbox();
  pending = items.length;
  emit();
}

async function replay(item: OutboxItem): Promise<void> {
  const headers = new Headers();
  if (item.body) headers.set("Content-Type", "application/json");
  const res = await fetch(item.url, {
    method: item.method,
    headers,
    body: item.body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: string }).error || "Sync failed")
        : `Sync failed (${res.status})`;
    throw new Error(message);
  }
}

export async function flushOutbox(): Promise<{ flushed: number; error?: string }> {
  if (syncing) return { flushed: 0 };
  if (!isBrowserOnline()) {
    await refreshPendingCount();
    return { flushed: 0 };
  }

  syncing = true;
  lastError = "";
  emit();

  let flushed = 0;
  try {
    const items = await listOutbox();
    pending = items.length;
    emit();
    for (const item of items) {
      await updateOutboxItem(item.id, { status: "syncing", error: "" });
      try {
        await replay(item);
        await removeOutboxItem(item.id);
        flushed += 1;
        pending = Math.max(0, pending - 1);
        emit();
      } catch (error) {
        if (isNetworkError(error)) {
          await updateOutboxItem(item.id, { status: "pending", error: "" });
          lastError = "";
          break;
        }
        const message = error instanceof Error ? error.message : "Sync failed";
        await updateOutboxItem(item.id, { status: "error", error: message });
        lastError = message;
        break;
      }
    }
    if (flushed > 0) {
      lastSyncedAt = new Date().toISOString();
      const qc = getQueryClient();
      if (qc) {
        await qc.invalidateQueries({ queryKey: queryKeys.dashboard });
        await qc.invalidateQueries({ queryKey: queryKeys.board.all });
        await qc.invalidateQueries({ queryKey: queryKeys.templates.all });
      }
    }
  } finally {
    syncing = false;
    await refreshPendingCount();
    emit();
  }
  return { flushed, error: lastError || undefined };
}

let listening = false;

export function startOutboxSync() {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  void refreshPendingCount();
  void flushOutbox();
  window.addEventListener("online", () => {
    void flushOutbox();
  });
  window.addEventListener("offline", () => {
    void refreshPendingCount();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
}
