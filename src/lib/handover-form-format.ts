/** Browser-safe helpers for Hand Over Form display (no Node/mysql). */

type TechNameSource = {
  id: string;
  name: string;
};

/** Current assigned manpower names (Prev M/P). */
export function prevMpLabel(job: {
  technicians?: { name?: string }[];
  technician?: { name?: string } | null;
}): string {
  const fromList = (job.technicians || [])
    .map((t) => String(t.name || "").trim())
    .filter(Boolean);
  if (fromList.length) return fromList.join("\n");
  const single = String(job.technician?.name || "").trim();
  return single || "";
}

/** Resolve Plan M/P technician ids to a display label (names when known). */
export function planMpLabel(
  ids: string[] | undefined,
  sources: Array<TechNameSource | undefined | null>
): string {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return "";
  const byId = new Map<string, string>();
  for (const src of sources) {
    if (!src?.id) continue;
    const name = String(src.name || "").trim();
    if (name && !byId.has(src.id)) byId.set(src.id, name);
  }
  // One name per line keeps the Master Handover column readable
  return list.map((id) => byId.get(id) || id).join("\n");
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Unit number for Hand Over Form rows (code before em/en dash). */
export function unitNoFromJob(job: { unit?: string }): string {
  const label = String(job.unit || "").trim();
  if (!label) return "—";
  const parts = label.split(/\s*[—–-]\s*/);
  return (parts[0] || label).trim() || "—";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normalize shift timestamp for storage (VARCHAR(16)).
 * Accepts `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (space/`T`, optional seconds).
 */
export function normalizeShiftDateTime(raw: unknown): string {
  const s = String(raw || "")
    .trim()
    .replace(" ", "T");
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return "";
  if (m[2] != null) return `${m[1]}T${m[2]}:${m[3]}`;
  return m[1];
}

/** Value for `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`). */
export function toDatetimeLocalValue(raw: string): string {
  const n = normalizeShiftDateTime(raw);
  if (!n) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return `${n}T00:00`;
  return n;
}

/** Current local date-time for datetime-local inputs. */
export function nowDatetimeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Display like 13-Oct-26 or 13-Oct-26 14:30 */
export function formatHandoverDate(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const day = pad2(d.getDate());
    const mon = MONTHS[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    const hasTime = /T\d{2}:\d{2}/.test(s) || /\d{2}:\d{2}/.test(s);
    if (hasTime) {
      return `${day}-${mon}-${yy} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    return `${day}-${mon}-${yy}`;
  }
  // datetime-local YYYY-MM-DDTHH:mm
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/
  );
  if (!m) return s;
  const mon = MONTHS[Number(m[2]) - 1] || m[2];
  const yy = m[1].slice(-2);
  if (m[4] != null) return `${m[3]}-${mon}-${yy} ${m[4]}:${m[5]}`;
  return `${m[3]}-${mon}-${yy}`;
}
