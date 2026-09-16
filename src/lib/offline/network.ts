export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (navigator.onLine === false) return false;
  // Sticky flag after a real network failure (DevTools Offline / NIC down)
  // while Chrome still reports onLine=true.
  if (
    typeof window !== "undefined" &&
    (window as Window & { __primaForceOffline?: boolean }).__primaForceOffline
  ) {
    return false;
  }
  return true;
}

export function markBrowserUnreachable() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __primaForceOffline?: boolean };
  if (w.__primaForceOffline) return;
  w.__primaForceOffline = true;
  window.dispatchEvent(new Event("prima-connectivity"));
}

export function clearBrowserUnreachable() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __primaForceOffline?: boolean };
  if (!w.__primaForceOffline) return;
  delete w.__primaForceOffline;
  window.dispatchEvent(new Event("prima-connectivity"));
}

function isTransportFailure(res: Response | null | undefined): boolean {
  if (!res) return true;
  // status 0 / error type = network layer failed (typical DevTools Offline)
  if (res.type === "error" || res.status === 0) return true;
  // Our SW synthesizes 503 Offline when fetch fails / times out.
  if (res.status === 503 && res.statusText === "Offline") return true;
  return false;
}

/** Default must exceed slow /api/* (MySQL); short values caused false Offline. */
export const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

/** DevTools Offline often leaves fetch pending or returns status-0. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      markBrowserUnreachable();
      reject(new TypeError("Failed to fetch"));
    }, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (init.signal?.aborted) {
      onAbort();
      return;
    }
    init.signal?.addEventListener("abort", onAbort, { once: true });
    fetch(url, init).then(
      (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (isTransportFailure(res)) {
          markBrowserUnreachable();
          reject(new TypeError("Failed to fetch"));
          return;
        }
        // Any real HTTP response (200/401/500…) means the network is up.
        clearBrowserUnreachable();
        resolve(res);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // User abort should not flip the app into sticky offline.
        if (
          err instanceof DOMException &&
          err.name === "AbortError" &&
          init.signal?.aborted
        ) {
          reject(err);
          return;
        }
        markBrowserUnreachable();
        reject(err);
      }
    );
  });
}

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) {
    return error.name === "NetworkError" || error.name === "AbortError";
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed") ||
      msg.includes("load failed") ||
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("connection refused") ||
      msg.includes("err_connection") ||
      msg.includes("err_empty_response") ||
      msg.includes("err_internet_disconnected") ||
      msg.includes("err_network") ||
      msg.includes("network error")
    );
  }
  return false;
}

export function isServerUnreachableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function canQueueMutation(
  url: string,
  method: string,
  body: BodyInit | null | undefined
): boolean {
  const verb = method.toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(verb)) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  const path = url.split("?")[0];
  if (!path.startsWith("/api/")) return false;
  if (path.startsWith("/api/session")) return false;
  if (path.startsWith("/api/auth")) return false;
  if (path.startsWith("/api/account/password")) return false;
  if (path.startsWith("/api/account/profile")) return false;
  if (path.startsWith("/api/account/photo")) return false;
  if (path.startsWith("/api/reports")) return false;
  if (path.startsWith("/api/backups")) return false;
  if (path.startsWith("/api/users")) return false;
  if (path.includes("/import")) return false;
  if (path.includes("/sync-sharepoint")) return false;
  if (path.endsWith("/download") || path.endsWith("/template")) return false;
  return true;
}
