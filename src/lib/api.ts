import { ensureMutationIds, type JsonRecord } from "@/lib/offline/ids";
import {
  canQueueMutation,
  isBrowserOnline,
  isNetworkError,
  isServerUnreachableStatus,
} from "@/lib/offline/network";
import {
  applyOptimisticMutation,
  prepareJobActionBody,
  prepareJobCreateBody,
} from "@/lib/offline/optimistic";
import { enqueueMutation } from "@/lib/offline/outbox";
import { getQueryClient } from "@/lib/offline/query-bridge";
import { flushOutbox, refreshPendingCount } from "@/lib/offline/sync";

function parseJsonBody(raw: string): JsonRecord | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function prepareInit(url: string, method: string, init?: RequestInit): RequestInit | undefined {
  if (!init) return init;
  if (typeof FormData !== "undefined" && init.body instanceof FormData) return init;
  if (typeof init.body !== "string") return init;
  const parsed = parseJsonBody(init.body);
  if (!parsed) return init;
  let withIds = ensureMutationIds(url, method, parsed);
  const qc = getQueryClient();
  if (method === "POST" && url.split("?")[0] === "/api/jobs") {
    withIds = prepareJobCreateBody(qc, withIds);
  }
  withIds = prepareJobActionBody(qc, url, method, withIds);
  return { ...init, body: JSON.stringify(withIds) };
}

function bodyText(init?: RequestInit): string | null {
  if (!init?.body) return null;
  if (typeof init.body === "string") return init.body;
  return null;
}

async function queueAndApply<T>(
  url: string,
  method: string,
  init?: RequestInit
): Promise<T> {
  const raw = bodyText(init);
  await enqueueMutation({ method, url, body: raw });
  await refreshPendingCount();
  const qc = getQueryClient();
  const result = qc
    ? applyOptimisticMutation(qc, method, url, raw)
    : { ok: true, queued: true };
  return result as T;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const prepared = prepareInit(url, method, init);
  const headers = new Headers(prepared?.headers || init?.headers || {});
  const isForm =
    typeof FormData !== "undefined" &&
    (prepared?.body instanceof FormData || init?.body instanceof FormData);
  if (!isForm && prepared?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    ...init,
    ...prepared,
    method,
    headers,
  };

  const queueable = canQueueMutation(url, method, requestInit.body);

  if (queueable && !isBrowserOnline()) {
    return queueAndApply<T>(url, method, requestInit);
  }

  try {
    const res = await fetch(url, requestInit);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hasAppError =
        data && typeof data === "object" && "error" in data;
      if (
        queueable &&
        (!hasAppError || isServerUnreachableStatus(res.status))
      ) {
        return queueAndApply<T>(url, method, requestInit);
      }
      const message = hasAppError
        ? String((data as { error?: string }).error || "Request failed")
        : "Request failed";
      throw new Error(message);
    }
    if (queueable) void flushOutbox();
    return data as T;
  } catch (error) {
    if (queueable && isNetworkError(error)) {
      return queueAndApply<T>(url, method, requestInit);
    }
    throw error;
  }
}
