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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
