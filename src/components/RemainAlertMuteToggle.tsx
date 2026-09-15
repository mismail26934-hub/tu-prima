"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import {
  stopRemainAlertSpeech,
  unlockRemainAlertAudio,
} from "@/lib/remain-alert-sound";
import {
  MAX_OVERTIME_HOURS,
  MAX_PCT_STEP,
  MIN_OVERTIME_HOURS,
  MIN_PCT_STEP,
  useRemainAlertStore,
} from "@/store/remainAlertStore";
import { NavHeaderPopBackdrop } from "@/components/NavHeaderPopBackdrop";

type Props = {
  variant?: "bar" | "menu";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onBeforeOpen?: () => void;
};

function SpeakerIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="m22 9-6 6M16 9l6 6" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

function AlertSoundFields() {
  const t = useT();
  const muted = useRemainAlertStore((s) => s.muted);
  const pctStep = useRemainAlertStore((s) => s.pctStep);
  const overtimeHours = useRemainAlertStore((s) => s.overtimeHours);
  const speechLang = useRemainAlertStore((s) => s.speechLang);
  const setMuted = useRemainAlertStore((s) => s.setMuted);
  const setPctStep = useRemainAlertStore((s) => s.setPctStep);
  const setOvertimeHours = useRemainAlertStore((s) => s.setOvertimeHours);
  const setSpeechLang = useRemainAlertStore((s) => s.setSpeechLang);

  return (
    <div className="remain-alert-fields">
      <button
        className="remain-alert-mute-row"
        type="button"
        aria-pressed={!muted}
        onClick={() => {
          unlockRemainAlertAudio();
          const next = !muted;
          setMuted(next);
          if (next) stopRemainAlertSpeech();
        }}
      >
        <SpeakerIcon muted={muted} />
        <span>{muted ? t("nav.alertSoundOn") : t("nav.alertSoundOff")}</span>
      </button>
      <div className="remain-alert-field">
        <span>{t("nav.alertSpeechLang")}</span>
        <div className="remain-alert-lang" role="group" aria-label={t("nav.alertSpeechLang")}>
          <button
            type="button"
            className={speechLang === "id" ? "is-active" : ""}
            aria-pressed={speechLang === "id"}
            onClick={() => {
              unlockRemainAlertAudio();
              if (speechLang !== "id") stopRemainAlertSpeech();
              setSpeechLang("id");
            }}
          >
            {t("nav.alertSpeechId")}
          </button>
          <button
            type="button"
            className={speechLang === "en" ? "is-active" : ""}
            aria-pressed={speechLang === "en"}
            onClick={() => {
              unlockRemainAlertAudio();
              if (speechLang !== "en") stopRemainAlertSpeech();
              setSpeechLang("en");
            }}
          >
            {t("nav.alertSpeechEn")}
          </button>
        </div>
      </div>
      <label className="remain-alert-field">
        <span>{t("nav.alertPctStep")}</span>
        <input
          type="number"
          min={MIN_PCT_STEP}
          max={MAX_PCT_STEP}
          step={1}
          value={pctStep}
          onChange={(e) => setPctStep(Number(e.target.value))}
        />
      </label>
      <label className="remain-alert-field">
        <span>{t("nav.alertOvertimeHours")}</span>
        <input
          type="number"
          min={MIN_OVERTIME_HOURS}
          max={MAX_OVERTIME_HOURS}
          step={0.5}
          value={overtimeHours}
          onChange={(e) => setOvertimeHours(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

export function RemainAlertMuteToggle({
  variant = "bar",
  open: openProp,
  onOpenChange,
  onBeforeOpen,
}: Props) {
  const t = useT();
  const muted = useRemainAlertStore((s) => s.muted);
  const hydrate = useRemainAlertStore((s) => s.hydrate);
  const [internalOpen, setInternalOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  function setOpen(next: boolean) {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  useEffect(() => {
    hydrate();
    const unlock = () => unlockRemainAlertAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [hydrate]);

  useEffect(() => {
    function onPop(e: Event) {
      if ((e as CustomEvent<string>).detail === "sound") return;
      setOpen(false);
    }
    window.addEventListener("prima-header-pop", onPop);
    return () => window.removeEventListener("prima-header-pop", onPop);
  }, [controlled]);

  useEffect(() => {
    if (!open || variant === "menu") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, variant, controlled]);

  const title = t("nav.alertSoundSettings");

  if (variant === "menu") {
    return (
      <div className="remain-alert-settings remain-alert-settings--menu">
        <p className="nav-menu-label">{title}</p>
        <AlertSoundFields />
      </div>
    );
  }

  return (
    <div
      className={`remain-alert-settings${open ? " is-open" : ""}`}
      ref={wrapRef}
    >
      <NavHeaderPopBackdrop open={open} onClose={() => setOpen(false)} />
      <button
        className={`btn btn-icon remain-alert-mute${muted ? " is-muted" : ""}`}
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => {
          unlockRemainAlertAudio();
          onBeforeOpen?.();
          const next = !open;
          if (next) {
            window.dispatchEvent(
              new CustomEvent("prima-header-pop", { detail: "sound" })
            );
          }
          setOpen(next);
        }}
      >
        <SpeakerIcon muted={muted} />
      </button>
      {open ? (
        <div className="remain-alert-pop" role="dialog" aria-label={title}>
          <p className="remain-alert-pop-title">{title}</p>
          <AlertSoundFields />
        </div>
      ) : null}
    </div>
  );
}
