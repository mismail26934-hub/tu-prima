"use client";

import type { JobWithDetails } from "@/lib/types";
import { normalizeJobPriority } from "@/lib/types";
import type { Locale } from "@/i18n/messages";

export type RemainTone = "green" | "orange" | "red";

let audioCtx: AudioContext | null = null;
const lastToneByJob = new Map<string, RemainTone>();
const lastPlayAt = new Map<string, number>();
let speakTimer: number | null = null;
let spokenUtterances: SpeechSynthesisUtterance[] = [];

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

export function unlockRemainAlertAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") void ctx.resume();
}

export function stopRemainAlertSpeech(): void {
  if (typeof window === "undefined") return;
  if (speakTimer != null) {
    window.clearTimeout(speakTimer);
    speakTimer = null;
  }
  window.speechSynthesis?.cancel();
  spokenUtterances = [];
}

function beep(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function playBeep(tone: "orange" | "red"): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  void ctx.resume();
  const t0 = ctx.currentTime + 0.02;
  if (tone === "orange") {
    beep(ctx, 740, t0, 0.16);
    beep(ctx, 740, t0 + 0.22, 0.16);
    return;
  }
  beep(ctx, 523, t0, 0.18);
  beep(ctx, 415, t0 + 0.2, 0.18);
  beep(ctx, 349, t0 + 0.4, 0.3);
}

function waitVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([]);
  }
  const synth = window.speechSynthesis;
  const current = synth.getVoices();
  if (current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    const finish = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 700);
  });
}

const FEMALE_VOICE_RE =
  /female|wanita|zira|jenny|aria|sonia|andika|gadis|samantha|victoria|karen|moira|tessa|hazel|susan|linda|catherine|heera|natasha|mega|damayanti|michelle|eva|anna/;
const MALE_VOICE_RE =
  /male|pria|david|mark|guy|ryan|ardian|daniel|fred|james|george|ravi|steffan|andrew/;

function voiceLang(voice: SpeechSynthesisVoice): string {
  return String(voice.lang || "")
    .toLowerCase()
    .replace("_", "-");
}

function voiceName(voice: SpeechSynthesisVoice): string {
  return String(voice.name || "").toLowerCase();
}

function isFemaleEnglishVoice(voice: SpeechSynthesisVoice): boolean {
  const name = voiceName(voice);
  if (!voiceLang(voice).startsWith("en")) return false;
  if (name.includes("google") && /us english/.test(name)) return false;
  if (FEMALE_VOICE_RE.test(name)) return true;
  if (MALE_VOICE_RE.test(name)) return false;
  return false;
}

/** Google Bahasa Indonesia, then Gadis / Andika. */
function pickIdVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined {
  const googleId = voices.find((voice) => {
    const name = voiceName(voice);
    const lang = voiceLang(voice);
    return (
      lang.startsWith("id") &&
      name.includes("google") &&
      (name.includes("indonesia") || name.includes("bahasa") || lang === "id-id")
    );
  });
  if (googleId) return googleId;

  const named = voices.find((voice) => {
    const name = voiceName(voice);
    return voiceLang(voice).startsWith("id") && /gadis|andika/.test(name);
  });
  if (named) return named;

  return voices.find((voice) => voiceLang(voice).startsWith("id"));
}

/** Google UK English Female, then Zira. Never Google US English (male). */
function pickEnVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined {
  const googleUkFemale = voices.find((voice) => {
    const name = voiceName(voice);
    return name.includes("google") && name.includes("uk") && name.includes("female");
  });
  if (googleUkFemale) return googleUkFemale;

  const zira = voices.find((voice) => voiceName(voice).includes("zira"));
  if (zira) return zira;

  return voices.find((voice) => isFemaleEnglishVoice(voice));
}

function formatSpokenDuration(totalSec: number, locale: Locale): string {
  const sec = Math.max(0, Math.floor(Math.abs(totalSec)));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (locale === "id") {
    if (h) parts.push(`${h} jam`);
    if (m) parts.push(`${m} menit`);
    if (s || !parts.length) parts.push(`${s} detik`);
    return parts.join(" ");
  }
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s || !parts.length) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function spokenStatus(status: string, locale: Locale): string {
  if (locale === "id") {
    switch (status) {
      case "in_progress":
        return "sedang berjalan";
      case "paused":
        return "dijeda";
      case "assigned":
        return "sudah di-assign";
      case "queued":
        return "antrian";
      case "done":
        return "selesai";
      default:
        return status || "tidak diketahui";
    }
  }
  switch (status) {
    case "in_progress":
      return "in progress";
    case "paused":
      return "paused";
    case "assigned":
      return "assigned";
    case "queued":
      return "queued";
    case "done":
      return "done";
    default:
      return status || "unknown";
  }
}

function spokenPriority(raw: unknown, locale: Locale): string {
  const priority = normalizeJobPriority(raw);
  if (locale === "id") {
    switch (priority) {
      case "URGENT":
        return "urgent";
      case "P1":
        return "prioritas satu";
      case "P2":
        return "prioritas dua";
      case "P3":
        return "prioritas tiga";
      default:
        return "tidak ada";
    }
  }
  switch (priority) {
    case "URGENT":
      return "urgent";
    case "P1":
      return "priority one";
    case "P2":
      return "priority two";
    case "P3":
      return "priority three";
    default:
      return "none";
  }
}

const LETTER_SAY: Record<string, string> = {
  a: "a",
  b: "be",
  c: "ce",
  d: "de",
  e: "e",
  f: "ef",
  g: "ge",
  h: "ha",
  i: "i",
  j: "je",
  k: "ka",
  l: "el",
  m: "em",
  n: "en",
  o: "o",
  p: "pe",
  q: "kiu",
  r: "er",
  s: "es",
  t: "te",
  u: "u",
  v: "ve",
  w: "we",
  x: "ex",
  y: "ye",
  z: "zet",
};

/** Stop TTS expanding codes like 16M into "16 meter". */
function speakAsWritten(text: string): string {
  return text.replace(/(\d+)\s*([A-Za-z])\b/g, (_, num: string, letter: string) => {
    const say = LETTER_SAY[letter.toLowerCase()] || letter.toLowerCase();
    return `${num} ${say}`;
  });
}

export function buildRemainAlertSpeech(
  job: JobWithDetails,
  tone: "orange" | "red",
  remainingSec: number,
  remainingPct: number,
  estimateSec: number,
  locale: Locale
): string {
  const rawTitle = String(job.title || "").trim();
  const title = speakAsWritten(
    (rawTitle || (locale === "id" ? "tanpa judul" : "untitled")).toLowerCase()
  );
  const rawUnit = String(job.unit || "").trim();
  const unit = speakAsWritten(
    (rawUnit || (locale === "id" ? "tanpa unit" : "no unit")).toLowerCase()
  );
  const priority = spokenPriority(job.priority, locale);
  const techs = speakAsWritten(
    job.technicians?.length
      ? job.technicians.map((tech) => tech.name).filter(Boolean).join(", ")
      : job.technician?.name || (locale === "id" ? "belum di-assign" : "not assigned")
  );
  const assigner = speakAsWritten(
    String(job.assigned_by_user_name || "").trim() ||
      (locale === "id" ? "tidak ada" : "none")
  );
  const delegate = speakAsWritten(
    String(job.delegated_to_user_name || "").trim() ||
      (locale === "id" ? "tidak ada" : "none")
  );
  const progress = Math.round(Number(job.progress_pct || 0));
  const remainAbs = formatSpokenDuration(remainingSec, locale);
  const pct = Math.max(0, remainingPct).toFixed(0);
  const level = locale === "id"
    ? tone === "orange" ? "oranye" : "merah"
    : tone === "orange" ? "orange" : "red";

  let remainLine: string;
  if (estimateSec <= 0) {
    remainLine = locale === "id" ? "Estimasi belum diisi." : "Estimate is not set.";
  } else if (remainingSec < 0) {
    remainLine =
      locale === "id"
        ? `Sudah melebihi estimasi ${remainAbs}.`
        : `Over estimate by ${remainAbs}.`;
  } else {
    remainLine =
      locale === "id"
        ? `Sisa estimasi ${remainAbs}, ${pct} persen tersisa.`
        : `Estimated remaining ${remainAbs}, ${pct} percent remaining.`;
  }

  if (locale === "id") {
    return [
      `Peringatan sisa estimasi ${level}.`,
      `Job ${title}.`,
      `Unit ${unit}.`,
      `Prioritas ${priority}.`,
      `Status ${spokenStatus(job.status, locale)}.`,
      `Teknisi ${techs}.`,
      `Penugas ${assigner}.`,
      `Delegasi ${delegate}.`,
      `Progress ${progress} persen.`,
      remainLine,
    ].join(" ");
  }
  return [
    `${level} remaining-estimate alert.`,
    `Job ${title}.`,
    `Unit ${unit}.`,
    `Priority ${priority}.`,
    `Status ${spokenStatus(job.status, locale)}.`,
    `Technicians ${techs}.`,
    `Assigned by ${assigner}.`,
    `Delegated to ${delegate}.`,
    `Progress ${progress} percent.`,
    remainLine,
  ].join(" ");
}

function speakOnce(
  text: string,
  voice: SpeechSynthesisVoice | undefined,
  lang: string
): Promise<void> {
  return new Promise((resolve) => {
    if (!text.trim() || typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    spokenUtterances.push(utter);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || lang;
    } else {
      utter.lang = lang;
    }
    utter.rate = 1;
    utter.pitch = 1.05;
    const fallback = window.setTimeout(() => resolve(), 90_000);
    utter.onend = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    utter.onerror = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    window.speechSynthesis.speak(utter);
  });
}

async function speakJobAlert(idText: string, enText: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const voices = await waitVoices();
  const idVoice = pickIdVoice(voices);
  const enVoice = pickEnVoice(voices);
  spokenUtterances = [];
  await speakOnce(idText, idVoice, "id-ID");
  await new Promise((resolve) => window.setTimeout(resolve, 280));
  await speakOnce(enText, enVoice, "en-GB");
}

export function playRemainAlertWithSpeech(
  tone: "orange" | "red",
  job: JobWithDetails,
  remainingSec: number,
  remainingPct: number,
  estimateSec: number
): void {
  unlockRemainAlertAudio();
  playBeep(tone);
  if (speakTimer != null) window.clearTimeout(speakTimer);
  const idText = buildRemainAlertSpeech(
    job,
    tone,
    remainingSec,
    remainingPct,
    estimateSec,
    "id"
  );
  const enText = buildRemainAlertSpeech(
    job,
    tone,
    remainingSec,
    remainingPct,
    estimateSec,
    "en"
  );
  const delay = tone === "red" ? 900 : 550;
  speakTimer = window.setTimeout(() => {
    speakTimer = null;
    void speakJobAlert(idText, enText);
  }, delay);
}

/** First observation is silent. Later orange/red changes return the tone to play. */
export function remainAlertTransition(
  jobId: string,
  tone: RemainTone
): "orange" | "red" | null {
  const id = String(jobId || "").trim();
  if (!id) return null;
  const prev = lastToneByJob.get(id);
  lastToneByJob.set(id, tone);
  if (prev == null || prev === tone) return null;
  if (tone !== "orange" && tone !== "red") return null;
  const key = `${id}:${tone}`;
  const now = Date.now();
  if (now - (lastPlayAt.get(key) || 0) < 4000) return null;
  lastPlayAt.set(key, now);
  return tone;
}

export function isRemainAlertOwner(
  job: { assigned_by_user_id?: string; delegated_to_user_id?: string },
  userId: string
): boolean {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  return (
    String(job.assigned_by_user_id || "").trim() === uid ||
    String(job.delegated_to_user_id || "").trim() === uid
  );
}
