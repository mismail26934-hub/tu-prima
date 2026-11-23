"use client";

import {
  useCallback,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

type Props = {
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">;

/**
 * Mouse click-drag pans overflow scroll. Touch keeps native pan scrolling.
 * (Browsers only select text on mouse-drag by default.)
 */
export function DragScroll({ children, className, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, label, [role='button']")) {
      return;
    }
    // Let native text selection work on cells (I-beam / block text).
    // Hold Alt to pan-drag instead while starting on a cell.
    if (target?.closest("td, th") && !e.altKey) {
      return;
    }
    suppressClick.current = false;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-drag-scrolling");
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const el = ref.current;
    if (!state || !el || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      state.moved = true;
      suppressClick.current = true;
    }
    if (!state.moved) return;
    el.scrollLeft = state.scrollLeft - dx;
    el.scrollTop = state.scrollTop - dy;
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const el = ref.current;
    if (!state || state.pointerId !== e.pointerId) return;
    drag.current = null;
    el?.classList.remove("is-drag-scrolling");
    try {
      el?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const onClickCapture = useCallback((e: ReactPointerEvent<HTMLDivElement> | React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      {...rest}
      ref={ref}
      className={["drag-scroll", className].filter(Boolean).join(" ")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}
