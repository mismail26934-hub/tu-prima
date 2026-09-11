import { formatDuration } from "./duration";
import type {
  Job,
  JobHandover,
  JobStatus,
  PartLoanStatus,
  StepStatus,
} from "./types";

const FONNTE_SEND_URL = "https://api.fonnte.com/send";
const FONNTE_GET_GROUP_URL = "https://api.fonnte.com/get-whatsapp-group";
const FONNTE_FETCH_GROUP_URL = "https://api.fonnte.com/fetch-group";
const TIME_ZONE = "Asia/Makassar";
const MAX_NOTE_CHARS = 800;
const MAX_DESC_CHARS = 240;
const SEND_TIMEOUT_MS = 15_000;

export type HandoverNotifyAction = "create" | "update" | "delete";

export type HandoverNotifyStep = {
  order: number;
  name: string;
  status: StepStatus;
  note?: string;
  technicianNames?: string;
  elapsedLabel?: string;
};

export type HandoverNotifyPartLoan = {
  order: number;
  part_name: string;
  status: PartLoanStatus;
  note?: string;
  user_name?: string;
};

export type HandoverNotifySnapshot = {
  technicianNames: string;
  steps: HandoverNotifyStep[];
  partLoans: HandoverNotifyPartLoan[];
  progressPct: number;
  elapsedSec: number;
};

export type HandoverNotifyPayload = {
  action: HandoverNotifyAction;
  job: Job;
  handover: JobHandover;
  technicianNames?: string;
  previous?: JobHandover | null;
  recipientPhone?: string;
  steps?: HandoverNotifyStep[];
  partLoans?: HandoverNotifyPartLoan[];
  progressPct?: number;
  elapsedSec?: number;
};

type FonnteGroup = { id?: string; name?: string };

let cachedGroupId = "";
let fetchedGroupList = false;

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

export function publicAppOrigin(): string {
  return (env("APP_PUBLIC_URL") || env("AUTH_URL")).replace(/\/+$/, "");
}

export function jobDeepLinkUrl(jobId: string): string {
  const origin = publicAppOrigin();
  const id = String(jobId || "").trim();
  if (!origin || !id) return "";
  return `${origin}/?job=${encodeURIComponent(id)}`;
}

function token(): string {
  return env("FONNTE_TOKEN");
}

function enabled(): boolean {
  const flag = env("FONNTE_ENABLED").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(token());
}

function notifyForemanDirect(): boolean {
  const flag = env("FONNTE_NOTIFY_FOREMAN").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

export function isWaNotifyConfigured(): boolean {
  return enabled();
}

/** Fonnte-friendly Indonesian mobile: 628xxxxxxxxxx */
export function normalizeWhatsAppPhone(raw: string): string {
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8") && digits.length >= 9) return `62${digits}`;
  return "";
}

function waPlain(value: unknown, fallback = "—"): string {
  const text = String(value ?? "")
    .replace(/[*_~`]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  return text || fallback;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function jobStatusLabel(status: JobStatus | string): string {
  switch (status) {
    case "queued":
      return "Antrian";
    case "assigned":
      return "Ditugaskan";
    case "in_progress":
      return "Sedang dikerjakan";
    case "paused":
      return "Ditunda";
    case "done":
      return "Selesai";
    case "cancelled":
      return "Dibatalkan";
    default:
      return waPlain(status, "—");
  }
}

function formatWita(iso: string): string {
  const date = iso ? new Date(iso) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const formatted = new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(safe);
  return `${formatted} WITA`;
}

function priorityLabel(priority: string): string {
  const p = priority.trim().toUpperCase();
  if (p === "URGENT") return "🔴 URGENT";
  if (p === "P1") return "🟠 P1";
  if (p === "P2") return "🟡 P2";
  if (p === "P3") return "🔵 P3";
  return p;
}

function headingAction(payload: HandoverNotifyPayload): string {
  if (payload.action === "create") return "Handover baru";
  if (payload.action === "delete") return "Handover dihapus";
  const before = payload.previous?.done === "1";
  const after = payload.handover.done === "1";
  if (!before && after) return "Handover selesai";
  if (before && !after) return "Handover dibuka kembali";
  return "Handover diperbarui";
}

function headingFor(payload: HandoverNotifyPayload): string {
  const action = headingAction(payload);
  const to = waPlain(payload.handover.to_name, "");
  if (to && to !== "—") return `*${action} ke ${to}*`;
  return `*${action}*`;
}

function handoverFromToLine(payload: HandoverNotifyPayload): string {
  const from = waPlain(
    payload.handover.from_name || payload.handover.user_name,
    ""
  );
  const to = waPlain(payload.handover.to_name, "");
  if (from && from !== "—" && to && to !== "—") {
    return `Handover dari ${from} ke *${to}*`;
  }
  if (from && from !== "—") return `Handover dari ${from}`;
  if (to && to !== "—") return `Handover ke *${to}*`;
  return "Handover";
}

function splitStepName(name: string): { phase: string; label: string } {
  const idx = name.indexOf(": ");
  if (idx > 0) {
    return {
      phase: name.slice(0, idx).trim(),
      label: name.slice(idx + 2).trim() || name,
    };
  }
  return { phase: "", label: name };
}

function stepIcon(status: StepStatus | string): string {
  if (status === "done") return "✅";
  if (status === "in_progress") return "▶️";
  return "○";
}

function appendStepLines(lines: string[], steps: HandoverNotifyStep[]): void {
  if (!steps.length) return;
  const done = steps.filter((s) => s.status === "done").length;
  const active = steps.filter((s) => s.status === "in_progress").length;
  const pending = steps.filter((s) => s.status === "pending").length;
  lines.push(
    "",
    `*Step* (${done} Selesai • ${active} Sedang dikerjakan • ${pending} Belum dimulai)`
  );

  let lastPhase = "\0";
  for (const step of steps) {
    const { phase, label } = splitStepName(step.name);
    if (phase && phase !== lastPhase) {
      lines.push("", `*${waPlain(phase)}*`);
      lastPhase = phase;
    } else if (!phase && lastPhase !== "") {
      lastPhase = "";
    }
    lines.push(`${stepIcon(step.status)} ${step.order}. ${waPlain(label)}`);
    if (step.status === "pending") continue;
    const detail = [
      waPlain(step.technicianNames, ""),
      clip(waPlain(step.note, ""), 160),
      String(step.elapsedLabel || "").trim(),
    ].filter((part) => part && part !== "—");
    if (detail.length) lines.push(`    ${detail.join(" · ")}`);
  }
}

function appendPartLoanLines(
  lines: string[],
  partLoans: HandoverNotifyPartLoan[]
): void {
  if (!partLoans.length) return;
  lines.push("", "*Catatan peminjaman part*");
  for (const loan of partLoans) {
    const open = loan.status !== "closed";
    lines.push(
      `${open ? "▶️" : "✅"} ${loan.order}. ${waPlain(loan.part_name)}`
    );
    const fallback = open ? "Masih dipinjam" : "Sudah dikembalikan";
    const note = clip(waPlain(loan.note, ""), 160);
    const who = waPlain(loan.user_name, "");
    const detail = [
      note && note !== "—" ? note : fallback,
      who && who !== "—" ? who : "",
    ].filter(Boolean);
    if (detail.length) lines.push(`    ${detail.join(" · ")}`);
  }
}

export function buildHandoverWhatsAppMessage(
  payload: HandoverNotifyPayload,
  _audience: "group" | "direct" = "group"
): string {
  const { job, handover } = payload;
  const unit = waPlain(job.unit, "");
  const title = waPlain(job.title);
  const jobLine =
    unit && unit !== "—" ? `*${unit}* · ${title}` : `*${title}*`;
  const status = jobStatusLabel(job.status);
  const priority = priorityLabel(String(job.priority || ""));
  const statusLine = priority ? `${status} · ${priority}` : status;
  const desc = clip(waPlain(job.description, ""), MAX_DESC_CHARS);
  const note = clip(waPlain(handover.note, ""), MAX_NOTE_CHARS);
  const steps = payload.steps || [];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const progressBits: string[] = [];
  if (typeof payload.progressPct === "number") {
    progressBits.push(`Progress ${payload.progressPct}%`);
  }
  if (steps.length) {
    progressBits.push(`${doneCount}/${steps.length} step selesai`);
  }
  if (
    typeof payload.elapsedSec === "number" &&
    (job.started_at || payload.elapsedSec > 0)
  ) {
    progressBits.push(`Elapsed ${formatDuration(payload.elapsedSec)}`);
  }

  const lines = [headingFor(payload), jobLine, statusLine];
  if (desc && desc !== "—") lines.push(desc);
  if (progressBits.length) lines.push(progressBits.join(" · "));

  lines.push(
    "",
    handoverFromToLine(payload),
    `#${handover.order} ${waPlain(handover.title)}`
  );
  if (note && note !== "—") {
    lines.push("", note);
  }

  const ownerBits: string[] = [];
  if (job.assigned_by_user_name) {
    ownerBits.push(`Penugas: ${waPlain(job.assigned_by_user_name)}`);
  }
  if (job.delegated_to_user_name) {
    ownerBits.push(`Delegasi: ${waPlain(job.delegated_to_user_name)}`);
  }

  lines.push(
    "",
    `Teknisi job: ${waPlain(payload.technicianNames, "Belum ditugaskan")}`
  );
  if (ownerBits.length) lines.push(ownerBits.join(" · "));
  if (job.started_at) {
    lines.push(`Mulai ${formatWita(job.started_at)}`);
  }
  lines.push(
    `Dicatat ${waPlain(handover.user_name, "Sistem")} · ${formatWita(handover.updated_at)}`
  );

  appendStepLines(lines, steps);
  appendPartLoanLines(lines, payload.partLoans || []);

  const link = jobDeepLinkUrl(job.id);
  if (link) {
    lines.push("", "Buka job", link);
  }

  lines.push("", "Pesan otomatis PRIMA · jangan dibalas");
  return lines.join("\n");
}

async function fonntePost(
  url: string,
  body?: URLSearchParams
): Promise<Record<string, unknown>> {
  const auth = token();
  if (!auth) throw new Error("FONNTE_TOKEN belum diatur");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      ...(body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: body ?? undefined,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });

  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { detail: raw };
  }
  if (!res.ok) {
    throw new Error(`Fonnte HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }
  return json;
}

function matchGroup(
  groups: FonnteGroup[],
  name: string
): string {
  const needle = name.trim().toLowerCase();
  if (!needle) return "";
  const exact = groups.find(
    (g) => String(g.name || "").trim().toLowerCase() === needle
  );
  if (exact?.id) return String(exact.id);
  const partial = groups.find((g) =>
    String(g.name || "").toLowerCase().includes(needle)
  );
  return partial?.id ? String(partial.id) : "";
}

async function resolveTarget(): Promise<string> {
  const direct = env("FONNTE_GROUP_ID");
  if (direct) return direct;
  if (cachedGroupId) return cachedGroupId;

  const name = env("FONNTE_GROUP_NAME");
  if (!name) return "";

  const readGroups = async () => {
    const json = await fonntePost(FONNTE_GET_GROUP_URL);
    const data = Array.isArray(json.data) ? (json.data as FonnteGroup[]) : [];
    return data;
  };

  let groups = await readGroups();
  let id = matchGroup(groups, name);

  if (!id && !fetchedGroupList) {
    fetchedGroupList = true;
    const fetched = await fonntePost(FONNTE_FETCH_GROUP_URL);
    if (fetched.status === true || fetched.status === "true") {
      groups = await readGroups();
      id = matchGroup(groups, name);
    }
  }

  if (id) cachedGroupId = id;
  return id;
}

async function sendToTarget(
  target: string,
  message: string
): Promise<void> {
  const body = new URLSearchParams();
  body.set("target", target);
  body.set("message", message);
  const json = await fonntePost(FONNTE_SEND_URL, body);
  if (json.status === false || json.status === "false") {
    throw new Error(
      String(json.reason || json.detail || "Fonnte menolak pengiriman")
    );
  }
}

async function sendHandoverNotification(
  payload: HandoverNotifyPayload
): Promise<void> {
  if (!enabled()) return;

  const groupId = await resolveTarget().catch((err) => {
    console.error(
      "[wa-notify] gagal resolve grup:",
      err instanceof Error ? err.message : err
    );
    return "";
  });
  const phone =
    notifyForemanDirect()
      ? normalizeWhatsAppPhone(payload.recipientPhone || "")
      : "";

  if (!groupId && !phone) {
    console.warn(
      "[wa-notify] dilewati: atur FONNTE_GROUP_ID/FONNTE_GROUP_NAME, atau isi nomor HP foreman tujuan"
    );
    return;
  }

  const errors: string[] = [];
  if (groupId) {
    try {
      await sendToTarget(groupId, buildHandoverWhatsAppMessage(payload, "group"));
    } catch (err) {
      errors.push(
        `grup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (phone && phone !== groupId) {
    try {
      await sendToTarget(
        phone,
        buildHandoverWhatsAppMessage(payload, "direct")
      );
    } catch (err) {
      errors.push(
        `foreman: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (notifyForemanDirect() && (payload.handover.to_name || payload.handover.to_user_id) && !phone) {
    console.warn(
      "[wa-notify] nomor HP foreman tujuan kosong — hanya grup yang dikirimi"
    );
  }

  if (errors.length) {
    throw new Error(errors.join("; "));
  }
}

/** Fire-and-forget: gagal WA tidak boleh menggagalkan simpan handover. */
export function notifyHandoverWhatsApp(payload: HandoverNotifyPayload): void {
  void sendHandoverNotification(payload).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[wa-notify] gagal kirim handover:", detail);
  });
}
