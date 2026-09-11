import type { Job, JobHandover, JobStatus } from "./types";

const FONNTE_SEND_URL = "https://api.fonnte.com/send";
const FONNTE_GET_GROUP_URL = "https://api.fonnte.com/get-whatsapp-group";
const FONNTE_FETCH_GROUP_URL = "https://api.fonnte.com/fetch-group";
const TIME_ZONE = "Asia/Makassar";
const MAX_NOTE_CHARS = 800;
const SEND_TIMEOUT_MS = 15_000;

export type HandoverNotifyAction = "create" | "update" | "delete";

export type HandoverNotifyPayload = {
  action: HandoverNotifyAction;
  job: Job;
  handover: JobHandover;
  technicianNames?: string;
  previous?: JobHandover | null;
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

export function isWaNotifyConfigured(): boolean {
  return enabled() && Boolean(env("FONNTE_GROUP_ID") || env("FONNTE_GROUP_NAME"));
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
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(safe);
  return `${formatted} WITA`;
}

function headingFor(payload: HandoverNotifyPayload): string {
  if (payload.action === "create") return "HANDOVER BARU";
  if (payload.action === "delete") return "HANDOVER DIHAPUS";
  const before = payload.previous?.done === "1";
  const after = payload.handover.done === "1";
  if (!before && after) return "HANDOVER DISELESAIKAN";
  if (before && !after) return "HANDOVER DIBUKA KEMBALI";
  return "PEMBARUAN HANDOVER";
}

function introFor(payload: HandoverNotifyPayload): string {
  if (payload.action === "create") {
    return "Catatan handover baru telah dicatat pada job berikut.";
  }
  if (payload.action === "delete") {
    return "Catatan handover berikut telah dihapus dari job.";
  }
  const before = payload.previous?.done === "1";
  const after = payload.handover.done === "1";
  if (!before && after) {
    return "Catatan handover telah ditandai selesai.";
  }
  if (before && !after) {
    return "Status selesai pada catatan handover telah dibatalkan.";
  }
  return "Catatan handover pada job berikut telah diperbarui.";
}

export function buildHandoverWhatsAppMessage(
  payload: HandoverNotifyPayload
): string {
  const { job, handover } = payload;
  const note = clip(waPlain(handover.note, "Tidak ada catatan tambahan."), MAX_NOTE_CHARS);
  const lines = [
    "*PRIMA*",
    "_Progress Report & Inspection for Mechanic Allocation_",
    "",
    "────────────────────",
    `*${headingFor(payload)}*`,
    "────────────────────",
    "",
    introFor(payload),
    "",
    "*Job*",
    waPlain(job.title),
    "",
    "*Unit*",
    waPlain(job.unit),
  ];

  const priority = String(job.priority || "").trim();
  if (priority) {
    lines.push("", "*Prioritas*", priority);
  }

  lines.push(
    "",
    "*Status job*",
    jobStatusLabel(job.status),
    "",
    "*Teknisi*",
    waPlain(payload.technicianNames, "Belum ada teknisi yang ditugaskan."),
    "",
    "*Handover*",
    `#${handover.order}  ${waPlain(handover.title)}`,
    "",
    "*Ditujukan kepada*",
    waPlain(handover.to_name, "Tidak disebutkan"),
    "",
    "*Catatan*",
    note,
    "",
    "*Status handover*",
    handover.done === "1" ? "Selesai" : "Belum selesai",
    "",
    "*Dicatat oleh*",
    waPlain(handover.user_name, "Sistem"),
    "",
    "*Waktu*",
    formatWita(handover.updated_at)
  );

  const link = jobDeepLinkUrl(job.id);
  if (link) {
    lines.push("", "*Buka job di PRIMA*", link);
  }

  lines.push(
    "",
    "────────────────────",
    "_Pesan otomatis dari sistem PRIMA._",
    "_Mohon tidak membalas ke nomor ini._"
  );

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

async function sendHandoverNotification(
  payload: HandoverNotifyPayload
): Promise<void> {
  if (!enabled()) return;
  const target = await resolveTarget();
  if (!target) {
    console.warn(
      "[wa-notify] dilewati: atur FONNTE_GROUP_ID atau FONNTE_GROUP_NAME di .env.local"
    );
    return;
  }

  const message = buildHandoverWhatsAppMessage(payload);
  const body = new URLSearchParams();
  body.set("target", target);
  body.set("message", message);

  const json = await fonntePost(FONNTE_SEND_URL, body);
  if (json.status === false || json.status === "false") {
    throw new Error(String(json.reason || json.detail || "Fonnte menolak pengiriman"));
  }
}

/** Fire-and-forget: gagal WA tidak boleh menggagalkan simpan handover. */
export function notifyHandoverWhatsApp(payload: HandoverNotifyPayload): void {
  void sendHandoverNotification(payload).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[wa-notify] gagal kirim handover:", detail);
  });
}
