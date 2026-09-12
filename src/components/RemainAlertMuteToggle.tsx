"use client";

import { useEffect } from "react";
import { useT } from "@/i18n/useT";
import {
  stopRemainAlertSpeech,
  unlockRemainAlertAudio,
} from "@/lib/remain-alert-sound";
import { useRemainAlertStore } from "@/store/remainAlertStore";

export function RemainAlertMuteToggle() {
  const t = useT();
  const muted = useRemainAlertStore((s) => s.muted);
  const hydrate = useRemainAlertStore((s) => s.hydrate);
  const toggleMuted = useRemainAlertStore((s) => s.toggleMuted);

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

  const label = muted ? t("nav.alertSoundOn") : t("nav.alertSoundOff");

  return (
    <button
      className={`btn btn-icon remain-alert-mute${muted ? " is-muted" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={muted}
      title={label}
      onClick={() => {
        unlockRemainAlertAudio();
        const next = !muted;
        toggleMuted();
        if (next) stopRemainAlertSpeech();
      }}
    >
      {muted ? (
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
      ) : (
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
      )}
    </button>
  );
}
