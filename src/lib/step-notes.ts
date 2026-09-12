import type { JobStep, JobStepNote } from "@/lib/types";

export type { JobStepNote };

const TIME_ZONE = "Asia/Makassar";

function newNoteId(): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `SN-${rand}`;
}

function normalizeNote(raw: unknown, fallbackId = ""): JobStepNote | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const body = String(row.body || row.note || "").trim();
  if (!body) return null;
  const editedAt = String(row.edited_at || "").trim();
  return {
    id: String(row.id || "").trim() || fallbackId || newNoteId(),
    body: body.slice(0, 4000),
    user_id: String(row.user_id || "").trim(),
    user_name: String(row.user_name || "").trim(),
    created_at: String(row.created_at || row.at || "").trim(),
    ...(editedAt
      ? {
          edited_at: editedAt,
          edited_by_user_id: String(row.edited_by_user_id || "").trim(),
          edited_by_name: String(row.edited_by_name || "").trim(),
        }
      : {}),
  };
}

export function parseStepNotes(
  raw: unknown,
  fallback?: {
    stepId?: string;
    note?: string;
    user_id?: string;
    user_name?: string;
    at?: string;
  }
): JobStepNote[] {
  let parsed: unknown = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (Array.isArray(parsed)) {
    const notes = parsed
      .map((row, i) =>
        normalizeNote(
          row,
          fallback?.stepId ? `SN-legacy-${fallback.stepId}-${i}` : ""
        )
      )
      .filter((n): n is JobStepNote => Boolean(n));
    if (notes.length) return notes;
  }
  const body = String(fallback?.note || "").trim();
  if (!body) return [];
  return [
    {
      id: fallback?.stepId ? `SN-legacy-${fallback.stepId}` : newNoteId(),
      body: body.slice(0, 4000),
      user_id: String(fallback?.user_id || "").trim(),
      user_name: String(fallback?.user_name || "").trim(),
      created_at: String(fallback?.at || "").trim(),
    },
  ];
}

export function serializeStepNotes(notes: JobStepNote[]): string {
  return JSON.stringify(
    notes.map((n) => ({
      id: n.id,
      body: n.body,
      user_id: n.user_id,
      user_name: n.user_name,
      created_at: n.created_at,
      ...(n.edited_at
        ? {
            edited_at: n.edited_at,
            edited_by_user_id: n.edited_by_user_id || "",
            edited_by_name: n.edited_by_name || "",
          }
        : {}),
    }))
  );
}

export function hydrateStepNotes(step: {
  id?: string;
  note?: string;
  notes?: unknown;
  note_updated_by_user_id?: string;
  note_updated_by_name?: string;
  note_updated_at?: string;
}): JobStepNote[] {
  return parseStepNotes(step.notes, {
    stepId: step.id,
    note: step.note,
    user_id: step.note_updated_by_user_id,
    user_name: step.note_updated_by_name,
    at: step.note_updated_at,
  });
}

export function stepHasNote(step: {
  id?: string;
  note?: string;
  notes?: unknown;
  note_updated_by_user_id?: string;
  note_updated_by_name?: string;
  note_updated_at?: string;
}): boolean {
  return hydrateStepNotes(step).length > 0;
}

export function formatStepNotesPlain(notes: JobStepNote[]): string {
  return notes
    .map((n) => {
      const who = n.user_name || n.user_id;
      const line = who ? `${who}: ${n.body}` : n.body;
      const editor = String(n.edited_by_name || "").trim();
      return editor ? `${line} (diedit oleh ${editor})` : line;
    })
    .join("\n");
}

/** PDF report: timestamp | author (edited by), then body. */
export function formatStepNotesReport(notes: JobStepNote[]): string {
  return notes
    .map((n) => {
      const body = String(n.body || "").trim();
      if (!body) return "";
      const at = formatStepNoteAt(String(n.created_at || ""));
      const who = String(n.user_name || n.user_id || "").trim();
      const editor = String(n.edited_by_name || "").trim();
      const edited = editor ? ` (diedit oleh ${editor})` : "";
      const meta = [at, who].filter(Boolean).join(" | ");
      const head = meta ? `${meta}${edited}` : edited.trim();
      return head ? `${head} :\n${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function formatStepNoteAt(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(date);
}

export function attachStepNotes<T extends Partial<JobStep>>(step: T): T {
  const notes = hydrateStepNotes({
    id: String(step.id || ""),
    note: step.note,
    notes: step.notes,
    note_updated_by_user_id: step.note_updated_by_user_id,
    note_updated_by_name: step.note_updated_by_name,
    note_updated_at: step.note_updated_at,
  });
  const last = notes[notes.length - 1];
  return {
    ...step,
    notes,
    note: last?.body || String(step.note || ""),
    note_updated_by_user_id:
      last?.user_id || step.note_updated_by_user_id || "",
    note_updated_by_name:
      last?.user_name || step.note_updated_by_name || "",
    note_updated_at:
      last?.edited_at || last?.created_at || step.note_updated_at || "",
  };
}

export function withAppendedStepNote(
  step: JobStep,
  input: {
    id?: string;
    body: string;
    user_id?: string;
    user_name?: string;
    created_at?: string;
  }
): JobStep {
  const body = String(input.body || "").trim().slice(0, 4000);
  if (!body) return attachStepNotes(step);
  const notes = hydrateStepNotes(step);
  const requestedId = String(input.id || "").trim();
  if (requestedId && notes.some((n) => n.id === requestedId)) {
    return attachStepNotes({ ...step, notes });
  }
  const last = notes[notes.length - 1];
  if (last && last.body === body && !requestedId) {
    return attachStepNotes({ ...step, notes });
  }
  const next: JobStepNote = {
    id: requestedId || newNoteId(),
    body,
    user_id: String(input.user_id || "").trim(),
    user_name: String(input.user_name || "").trim(),
    created_at: String(input.created_at || "").trim() || new Date().toISOString(),
  };
  return attachStepNotes({ ...step, notes: [...notes, next] });
}

export function withUpdatedStepNote(
  step: JobStep,
  input: {
    id: string;
    body: string;
    edited_at?: string;
    edited_by_user_id?: string;
    edited_by_name?: string;
  }
): JobStep {
  const noteId = String(input.id || "").trim();
  const body = String(input.body || "").trim().slice(0, 4000);
  const notes = hydrateStepNotes(step);
  if (!noteId || !body) return attachStepNotes({ ...step, notes });
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx < 0) return attachStepNotes({ ...step, notes });
  const current = notes[idx];
  if (current.body === body) return attachStepNotes({ ...step, notes });
  const next = notes.slice();
  next[idx] = {
    ...current,
    body,
    edited_at:
      String(input.edited_at || "").trim() || new Date().toISOString(),
    edited_by_user_id: String(input.edited_by_user_id || "").trim(),
    edited_by_name: String(input.edited_by_name || "").trim(),
  };
  return attachStepNotes({ ...step, notes: next });
}
