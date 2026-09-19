"use client";

import type { JobWithDetails } from "@/lib/types";
import { normalizeJobPriority } from "@/lib/types";
import type { Locale } from "@/i18n/messages";

export type RemainTone = "green" | "orange" | "red";

/** Hijau: sisa ≥50% · Oranye: 20% < sisa < 50% · Merah: sisa ≤20% atau overtime. */
export function remainToneFor(
  estimateSec: number,
  remainingSec: number,
  remainingPct: number
): RemainTone {
  if (estimateSec <= 0 || remainingSec <= 0 || remainingPct <= 20) return "red";
  if (remainingPct >= 50) return "green";
  return "orange";
}

const PCT_STEP = 5;
const OVERTIME_MS = 60 * 60 * 1000;

type TickState = {
  lastPct: number;
  lastTone: RemainTone;
  lastOvertimeAt: number | null;
};
type AlertItem = {
  jobId: string;
  tone: RemainTone;
  job: JobWithDetails;
  remainingSec: number;
  remainingPct: number;
  estimateSec: number;
  speechLang: Locale;
};

let audioCtx: AudioContext | null = null;
const tickByJob = new Map<string, TickState>();
let alertQueue: AlertItem[] = [];
let draining = false;
let speakGen = 0;
let currentJobId: string | null = null;
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
  speakGen += 1;
  alertQueue = [];
  currentJobId = null;
  window.speechSynthesis?.cancel();
  spokenUtterances = [];
}

export function stopRemainAlertForJob(jobId: string): void {
  const id = String(jobId || "").trim();
  if (!id) return;
  tickByJob.delete(id);
  alertQueue = alertQueue.filter((item) => item.jobId !== id);
  if (currentJobId === id) {
    speakGen += 1;
    currentJobId = null;
    window.speechSynthesis?.cancel();
    spokenUtterances = [];
  }
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

function playBeep(tone: RemainTone): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  void ctx.resume();
  const t0 = ctx.currentTime + 0.02;
  if (tone === "red") {
    beep(ctx, 523, t0, 0.18);
    beep(ctx, 415, t0 + 0.2, 0.18);
    beep(ctx, 349, t0 + 0.4, 0.3);
    return;
  }
  beep(ctx, 740, t0, 0.16);
  beep(ctx, 740, t0 + 0.22, 0.16);
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

/** Stop TTS expanding codes like 16M into "16 meter", or "—" into "sampai". */
function speakAsWritten(text: string): string {
  return text
    .replace(/\s*[—–−]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/(\d+)\s*([A-Za-z])\b/g, (_, num: string, letter: string) => {
      const say = LETTER_SAY[letter.toLowerCase()] || letter.toLowerCase();
      return `${num} ${say}`;
    });
}

export function buildRemainAlertSpeech(
  job: JobWithDetails,
  tone: RemainTone,
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
  const level =
    locale === "id"
      ? tone === "red"
        ? "kritis"
        : tone === "orange"
          ? "mohon perhatian"
          : "normal"
      : tone === "red"
        ? "critical"
        : tone === "orange"
          ? "caution"
          : "normal";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitUntilQuiet(gen: number): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (gen !== speakGen) {
        resolve();
        return;
      }
      const synth = window.speechSynthesis;
      if (!synth.speaking && !synth.pending) {
        resolve();
        return;
      }
      if (Date.now() - started > 90_000) {
        resolve();
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function speakOnce(
  text: string,
  voice: SpeechSynthesisVoice | undefined,
  lang: string,
  gen: number
): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== speakGen) {
      resolve();
      return;
    }
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
    const finish = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

async function speakJobAlert(
  text: string,
  locale: Locale,
  gen: number
): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (gen !== speakGen) return;
  const voices = await waitVoices();
  if (gen !== speakGen) return;
  spokenUtterances = [];
  if (locale === "en") {
    await speakOnce(text, pickEnVoice(voices), "en-GB", gen);
  } else {
    await speakOnce(text, pickIdVoice(voices), "id-ID", gen);
  }
  if (gen !== speakGen) return;
  await waitUntilQuiet(gen);
}

async function playQueuedItem(item: AlertItem, gen: number): Promise<void> {
  if (gen !== speakGen) return;
  unlockRemainAlertAudio();
  playBeep(item.tone);
  await delay(item.tone === "red" ? 900 : 550);
  if (gen !== speakGen) return;
  const locale: Locale = item.speechLang === "en" ? "en" : "id";
  const text = buildRemainAlertSpeech(
    item.job,
    item.tone,
    item.remainingSec,
    item.remainingPct,
    item.estimateSec,
    locale
  );
  await speakJobAlert(text, locale, gen);
}

async function drainAlertQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (alertQueue.length) {
      const item = alertQueue.shift();
      if (!item) break;
      const gen = speakGen;
      currentJobId = item.jobId;
      await playQueuedItem(item, gen);
      if (gen !== speakGen) continue;
      currentJobId = null;
    }
  } finally {
    draining = false;
    if (speakGen && currentJobId && !alertQueue.length) {
      currentJobId = null;
    }
    if (alertQueue.length) void drainAlertQueue();
  }
}

export function playRemainAlertWithSpeech(
  tone: RemainTone,
  job: JobWithDetails,
  remainingSec: number,
  remainingPct: number,
  estimateSec: number,
  speechLang: Locale = "id"
): void {
  const jobId = String(job.id || "").trim();
  if (!jobId) return;
  const item: AlertItem = {
    jobId,
    tone,
    job,
    remainingSec,
    remainingPct,
    estimateSec,
    speechLang: speechLang === "en" ? "en" : "id",
  };
  alertQueue = alertQueue.filter((row) => row.jobId !== jobId);
  if (currentJobId === jobId) {
    speakGen += 1;
    window.speechSynthesis?.cancel();
    spokenUtterances = [];
  }
  alertQueue.push(item);
  void drainAlertQueue();
}

/** First look is silent. Speak only on orange/red enter, % drop while orange/red, 0%, then overtime. */
export function remainAlertTick(input: {
  jobId: string;
  status: string;
  tone: RemainTone;
  remainingPct: number;
  remainingSec: number;
  estimateSec: number;
  pctStep?: number;
  overtimeMs?: number;
}): RemainTone | null {
  const id = String(input.jobId || "").trim();
  if (!id) return null;
  if (input.status === "done" || input.status === "cancelled") {
    stopRemainAlertForJob(id);
    return null;
  }
  if (input.estimateSec <= 0) return null;
  const step = Math.max(1, Math.round(input.pctStep ?? PCT_STEP));
  const overtimeMs = Math.max(60_000, input.overtimeMs ?? OVERTIME_MS);
  const pct =
    input.remainingSec <= 0
      ? 0
      : Math.max(0, Math.min(100, input.remainingPct));
  const prev = tickByJob.get(id);
  if (!prev) {
    tickByJob.set(id, {
      lastPct: pct,
      lastTone: input.tone,
      lastOvertimeAt: input.remainingSec <= 0 ? Date.now() : null,
    });
    return null;
  }

  const lastTone = prev.lastTone ?? input.tone;
  const enteredAlertTone =
    (input.tone === "orange" || input.tone === "red") && lastTone !== input.tone;

  if (enteredAlertTone) {
    prev.lastTone = input.tone;
    prev.lastPct = pct;
    if (input.remainingSec <= 0) prev.lastOvertimeAt = Date.now();
    else prev.lastOvertimeAt = null;
    return input.tone;
  }
  prev.lastTone = input.tone;

  if (input.remainingSec <= 0) {
    if (prev.lastPct > 0) {
      prev.lastPct = 0;
      prev.lastOvertimeAt = Date.now();
      return "red";
    }
    const from = prev.lastOvertimeAt ?? Date.now();
    if (Date.now() - from >= overtimeMs) {
      prev.lastOvertimeAt = Date.now();
      return "red";
    }
    return null;
  }

  prev.lastOvertimeAt = null;
  if (pct <= prev.lastPct - step) {
    prev.lastPct = pct;
    // Green remaining-estimate cards stay silent.
    if (input.tone === "green") return null;
    return input.tone;
  }
  return null;
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
