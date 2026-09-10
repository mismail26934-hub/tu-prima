const ID_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/** Windows-safe local timestamp for download filenames, e.g. 10_Sep_2026_22.22 */
export function fmtFileStamp(d = new Date()): string {
  const day = d.getDate();
  const mon = ID_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}_${mon}_${year}_${hh}.${mm}`;
}
