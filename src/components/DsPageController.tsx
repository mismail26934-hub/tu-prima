"use client";

import type { ReactNode } from "react";

type Props = {
  count: number;
  index: number;
  onPrev?: () => void;
  onNext?: () => void;
  onSelect?: (index: number) => void;
  size?: "lg" | "sm";
  showButtons?: boolean;
  /** Optional tone per bullet (remain / status). */
  tones?: Array<"default" | "success" | "warning" | "critical">;
  className?: string;
  bulletsLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  trailing?: ReactNode;
};

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 6 9 12l6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Design System TU Frame page controller (Figma 24:4785). */
export function DsPageController({
  count,
  index,
  onPrev,
  onNext,
  onSelect,
  size = "lg",
  showButtons = true,
  tones,
  className = "",
  bulletsLabel = "Pages",
  prevLabel = "Previous",
  nextLabel = "Next",
  trailing,
}: Props) {
  const safeCount = Math.max(0, count);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, safeCount - 1));

  return (
    <div
      className={`ds-page-controller${size === "sm" ? " ds-page-controller--sm" : ""}${className ? ` ${className}` : ""}`}
    >
      <div
        className="ds-page-controller-bullets"
        role="tablist"
        aria-label={bulletsLabel}
      >
        {Array.from({ length: safeCount }, (_, i) => {
          const tone = tones?.[i] || "default";
          const toneClass =
            tone === "success"
              ? " ds-dot--success"
              : tone === "warning"
                ? " ds-dot--warning"
                : tone === "critical"
                  ? " ds-dot--critical"
                  : "";
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === safeIndex}
              className={`ds-dot${i === safeIndex ? " is-active" : ""}${toneClass}`}
              onClick={() => onSelect?.(i)}
              disabled={!onSelect}
            />
          );
        })}
      </div>
      <div className="ds-page-controller-actions">
        {trailing}
        {showButtons ? (
          <>
            <button
              type="button"
              className="ds-icon-btn"
              onClick={onPrev}
              aria-label={prevLabel}
              disabled={!onPrev}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="ds-icon-btn"
              onClick={onNext}
              aria-label={nextLabel}
              disabled={!onNext}
            >
              <ChevronRight />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
