"use client";

import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

type Options = {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  /** Preferred panel width (px). */
  width?: number;
  /** Gap below the trigger (px). */
  offset?: number;
};

/**
 * Positions a dropdown with `position: fixed` so parent `overflow: hidden`
 * (e.g. `.job`) cannot clip it. Clamps into the viewport.
 */
export function useAnchoredPanelStyle({
  open,
  rootRef,
  width = 420,
  offset = 6,
}: Options): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>();

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root || !open) {
      setStyle(undefined);
      return;
    }
    const trigger =
      (root.querySelector(":scope > button") as HTMLElement | null) || root;
    const rect = trigger.getBoundingClientRect();
    const maxWidth = Math.min(width, window.innerWidth - 32);
    let left = rect.right - maxWidth;
    if (left < 16) left = 16;
    if (left + maxWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - 16 - maxWidth);
    }

    const estimatedHeight = Math.min(window.innerHeight * 0.7, 520);
    let top = rect.bottom + offset;
    if (top + estimatedHeight > window.innerHeight - 12) {
      const above = rect.top - offset - estimatedHeight;
      if (above >= 12) top = above;
      else top = Math.max(12, window.innerHeight - 12 - estimatedHeight);
    }

    setStyle({
      position: "fixed",
      top,
      left,
      right: "auto",
      width: maxWidth,
      zIndex: 10050,
    });
  }, [open, offset, rootRef, width]);

  useLayoutEffect(() => {
    measure();
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, open]);

  return open ? style : undefined;
}
