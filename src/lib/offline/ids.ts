/** Client-generated ids so offline creates stay stable after sync. */

export function newEntityId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}`;
}

export type JsonRecord = Record<string, unknown>;

export type JobStepPayload = {
  id: string;
  name: string;
  std_minutes: number;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeStepEntry(raw: unknown): JobStepPayload | null {
  if (typeof raw === "string") {
    const name = raw.trim();
    if (!name) return null;
    return { id: newEntityId("S"), name, std_minutes: 0 };
  }
  const row = asRecord(raw);
  if (!row) return null;
  const name = String(row.name || "").trim();
  if (!name) return null;
  return {
    id: String(row.id || "").trim() || newEntityId("S"),
    name,
    std_minutes: Number(row.std_minutes || 0) || 0,
  };
}

/** Attach stable ids to create payloads before fetch or outbox. */
export function ensureMutationIds(
  url: string,
  method: string,
  body: JsonRecord
): JsonRecord {
  if (method !== "POST") return body;
  const path = url.split("?")[0];
  const next = { ...body };

  if (path === "/api/jobs") {
    if (!String(next.id || "").trim()) next.id = newEntityId("J");
    if (Array.isArray(next.steps)) {
      next.steps = next.steps
        .map(normalizeStepEntry)
        .filter((s): s is JobStepPayload => Boolean(s));
    }
    return next;
  }

  if (path === "/api/units" && !String(next.id || "").trim()) {
    next.id = newEntityId("U");
  }
  if (path === "/api/technicians" && !String(next.id || "").trim()) {
    next.id = newEntityId("T");
  }
  if (path === "/api/attendance" && !String(next.id || "").trim()) {
    next.id = newEntityId("A");
  }
  if (path === "/api/job-templates" && !String(next.id || "").trim()) {
    next.id = newEntityId("tpl");
  }

  if (
    /^\/api\/jobs\/[^/]+\/handovers$/.test(path) &&
    !String(next.id || "").trim()
  ) {
    next.id = newEntityId("H");
  }
  if (
    /^\/api\/jobs\/[^/]+\/part-loans$/.test(path) &&
    !String(next.id || "").trim()
  ) {
    next.id = newEntityId("L");
  }

  return next;
}
