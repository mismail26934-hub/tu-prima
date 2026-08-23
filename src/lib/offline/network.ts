export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
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
  if (path.startsWith("/api/reports")) return false;
  if (path.startsWith("/api/backups")) return false;
  if (path.startsWith("/api/users")) return false;
  if (path.includes("/import")) return false;
  if (path.includes("/sync-sharepoint")) return false;
  if (path.endsWith("/download") || path.endsWith("/template")) return false;
  return true;
}
