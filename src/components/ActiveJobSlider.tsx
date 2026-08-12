"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { JobWithDetails } from "@/lib/types";
import { calcElapsedSec } from "@/lib/duration";
import { useT } from "@/i18n/useT";

const SLIDER_ENABLED_KEY = "tus-active-job-slider";
const SLIDER_DURATION_KEY = "tus-active-job-slider-duration";
const SLIDER_DURATION_UNIT_KEY = "tus-active-job-slider-duration-unit";
const DEFAULT_DURATION_MIN = 1;
const MIN_DURATION_MIN = 1;
const MAX_DURATION_MIN = 60;

function readSliderEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SLIDER_ENABLED_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function writeSliderEnabled(value: boolean) {
  try {
    localStorage.setItem(SLIDER_ENABLED_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readSliderDuration(): number {
  try {
    const raw = localStorage.getItem(SLIDER_DURATION_KEY);
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_DURATION_MIN;

    const unit = localStorage.getItem(SLIDER_DURATION_UNIT_KEY);
    if (unit !== "min") {
      const migrated =
        n >= 3 && n <= 60
          ? Math.max(MIN_DURATION_MIN, Math.ceil(n / 60))
          : Math.min(
              MAX_DURATION_MIN,
              Math.max(MIN_DURATION_MIN, Math.round(n))
            );
      writeSliderDuration(migrated);
      return migrated;
    }

    return Math.min(
      MAX_DURATION_MIN,
      Math.max(MIN_DURATION_MIN, Math.round(n))
    );
  } catch {
    return DEFAULT_DURATION_MIN;
  }
}

function writeSliderDuration(min: number) {
  try {
    localStorage.setItem(SLIDER_DURATION_KEY, String(min));
    localStorage.setItem(SLIDER_DURATION_UNIT_KEY, "min");
  } catch {
    /* ignore */
  }
}

function getRemainTone(job: JobWithDetails): "green" | "orange" | "red" {
  const estimateSec = Math.max(0, Number(job.estimated_minutes || 0) * 60);
  if (estimateSec <= 0) return "red";
  const elapsed = calcElapsedSec(job);
  const remainingSec = estimateSec - elapsed;
  const remainingPct =
    estimateSec > 0 ? (Math.max(0, remainingSec) / estimateSec) * 100 : 0;
  if (remainingSec <= 0 || remainingPct <= 20) return "red";
  if (remainingPct >= 50) return "green";
  return "orange";
}

type SliderContextValue = {
  jobs: JobWithDetails[];
  enabled: boolean;
  durationMin: number;
  paused: boolean;
  index: number;
  modalOpen: boolean;
  enableSlider: () => void;
  disableSlider: () => void;
  openModal: () => void;
  closeModal: () => void;
  onDurationChange: (raw: string) => void;
  goPrev: () => void;
  goNext: () => void;
  togglePaused: () => void;
  goTo: (index: number) => void;
};

const SliderContext = createContext<SliderContextValue | null>(null);

function useSliderContext() {
  return useContext(SliderContext);
}

/** Compact checkbox — place beside panel title. */
export function ActiveJobSliderToggle() {
  const t = useT();
  const ctx = useSliderContext();
  if (!ctx || ctx.jobs.length === 0) return null;

  return (
    <label className="active-job-slider-toggle active-job-slider-toggle--inline">
      <input
        type="checkbox"
        checked={ctx.enabled}
        onChange={(e) => {
          if (e.target.checked) {
            ctx.enableSlider();
            ctx.openModal();
          } else {
            ctx.disableSlider();
          }
        }}
      />
      <span>{t("slider.enable")}</span>
    </label>
  );
}

type ActiveJobSliderProps = {
  jobs: JobWithDetails[];
  renderJob: (job: JobWithDetails) => ReactNode;
  children: ReactNode;
};

export function ActiveJobSlider({
  jobs,
  renderJob,
  children,
}: ActiveJobSliderProps) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [durationMin, setDurationMin] = useState(DEFAULT_DURATION_MIN);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const wasEnabled = readSliderEnabled();
    setEnabled(wasEnabled);
    setDurationMin(readSliderDuration());
    if (wasEnabled) setModalOpen(false);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduceMotion(mq.matches);
    syncMotion();
    mq.addEventListener("change", syncMotion);
    return () => mq.removeEventListener("change", syncMotion);
  }, []);

  const jobIdsKey = jobs.map((j) => j.id).join("|");

  useEffect(() => {
    setIndex((current) => {
      if (jobs.length === 0) return 0;
      const currentId = jobs[current]?.id;
      if (currentId) {
        const sameJobIndex = jobs.findIndex((j) => j.id === currentId);
        if (sameJobIndex >= 0) return sameJobIndex;
      }
      return Math.min(current, jobs.length - 1);
    });
  }, [jobIdsKey, jobs.length]);

  const goTo = useCallback(
    (next: number) => {
      if (jobs.length === 0) return;
      const wrapped = ((next % jobs.length) + jobs.length) % jobs.length;
      setIndex(wrapped);
    },
    [jobs.length]
  );

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  useEffect(() => {
    if (!enabled || paused || jobs.length <= 1 || reduceMotion) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % jobs.length);
    }, durationMin * 60 * 1000);
    return () => window.clearInterval(id);
  }, [enabled, paused, jobs.length, durationMin, reduceMotion]);

  useEffect(() => {
    const on = enabled && jobs.length > 0;
    document.documentElement.classList.toggle("active-job-slider-mode", on);
    return () => {
      document.documentElement.classList.remove("active-job-slider-mode");
    };
  }, [enabled, jobs.length]);

  useEffect(() => {
    document.documentElement.classList.toggle("slider-modal-open", modalOpen);
    return () => {
      document.documentElement.classList.remove("slider-modal-open");
    };
  }, [modalOpen]);

  function enableSlider() {
    setEnabled(true);
    writeSliderEnabled(true);
    setPaused(false);
  }

  function disableSlider() {
    setEnabled(false);
    writeSliderEnabled(false);
    setModalOpen(false);
  }

  function onDurationChange(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(
      MAX_DURATION_MIN,
      Math.max(MIN_DURATION_MIN, Math.round(n))
    );
    setDurationMin(clamped);
    writeSliderDuration(clamped);
  }

  const ctx: SliderContextValue = {
    jobs,
    enabled,
    durationMin,
    paused,
    index,
    modalOpen,
    enableSlider,
    disableSlider,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    onDurationChange,
    goPrev,
    goNext,
    togglePaused: () => setPaused((p) => !p),
    goTo,
  };

  const currentJob = jobs[index];

  const sliderControls = (
    <>
      <label className="active-job-slider-duration">
        <span>{t("slider.duration")}</span>
        <input
          type="number"
          min={MIN_DURATION_MIN}
          max={MAX_DURATION_MIN}
          step={1}
          value={durationMin}
          onChange={(e) => onDurationChange(e.target.value)}
          aria-label={t("slider.duration")}
        />
        <span>{t("slider.minutes")}</span>
      </label>

      <span className="active-job-slider-counter">
        {t("slider.counter", {
          current: index + 1,
          total: jobs.length,
        })}
      </span>

      <div className="active-job-slider-nav">
        <button
          type="button"
          className="btn active-job-slider-btn"
          onClick={goPrev}
          aria-label={t("slider.prev")}
          title={t("slider.prev")}
        >
          ‹
        </button>
        <button
          type="button"
          className="btn active-job-slider-btn"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? t("slider.play") : t("slider.pause")}
          title={paused ? t("slider.play") : t("slider.pause")}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          type="button"
          className="btn active-job-slider-btn"
          onClick={goNext}
          aria-label={t("slider.next")}
          title={t("slider.next")}
        >
          ›
        </button>
      </div>
    </>
  );

  const sliderDots = (
    <div
      className="active-job-slider-dots"
      role="tablist"
      aria-label={t("slider.dotsLabel")}
    >
      {jobs.map((job, i) => {
        const tone = getRemainTone(job);
        return (
          <button
            key={job.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={t("slider.goToJob", {
              title: job.title,
              index: i + 1,
            })}
            title={job.title}
            className={`active-job-slider-dot active-job-slider-dot--${tone}${
              i === index ? " is-active" : ""
            }`}
            onClick={() => {
              goTo(i);
              setPaused(true);
            }}
          />
        );
      })}
    </div>
  );

  const settingsModal =
    modalOpen &&
    portalReady &&
    createPortal(
      <div
        className="modal-backdrop active-job-slider-modal-backdrop"
        onClick={() => setModalOpen(false)}
      >
        <div
          className="modal active-job-slider-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slider-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 id="slider-modal-title">{t("slider.modalTitle")}</h3>
            <div className="modal-header-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setModalOpen(false)}
              >
                {t("slider.close")}
              </button>
            </div>
          </div>
          <p className="active-job-slider-modal-hint">{t("slider.modalHint")}</p>
          <label className="active-job-slider-toggle active-job-slider-toggle--modal">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                if (e.target.checked) enableSlider();
                else disableSlider();
              }}
            />
            <span>{t("slider.enable")}</span>
          </label>
          {enabled && (
            <div className="active-job-slider-modal-controls">
              {sliderControls}
            </div>
          )}
        </div>
      </div>,
      document.body
    );

  const fullscreenPortal =
    enabled &&
    jobs.length > 0 &&
    portalReady &&
    createPortal(
      <div className="active-job-slider-screen" aria-live="polite">
        <div className="active-job-slider-bar active-job-slider-bar--screen">
          <label className="active-job-slider-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                if (e.target.checked) enableSlider();
                else disableSlider();
              }}
            />
            <span>{t("slider.enable")}</span>
          </label>
          {sliderControls}
        </div>
        <div className="active-job-slider-stage" key={currentJob?.id}>
          <div className="active-job-slider-job-shell">
            {currentJob ? renderJob(currentJob) : null}
          </div>
        </div>
        {sliderDots}
      </div>,
      document.body
    );

  return (
    <SliderContext.Provider value={ctx}>
      {enabled ? null : children}
      {settingsModal}
      {fullscreenPortal}
    </SliderContext.Provider>
  );
}
