"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const MOBILE_MQ = "(max-width: 720px)";

/** Matches hamburger / sheet breakpoint in globals.css */
export function useIsNarrowNav() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Ref-count so sibling pops (alerts / sound / manage / account) don't clear the lock. */
let navHeaderPopLock = 0;

function acquireNavHeaderPopLock() {
  navHeaderPopLock += 1;
  document.documentElement.classList.add("nav-header-pop-open");
}

function releaseNavHeaderPopLock() {
  navHeaderPopLock = Math.max(0, navHeaderPopLock - 1);
  if (navHeaderPopLock === 0) {
    document.documentElement.classList.remove("nav-header-pop-open");
  }
}

/** Dimmed overlay matching Job baru modal (`var(--overlay)`). */
export function NavHeaderPopBackdrop({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const narrow = useIsNarrowNav();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open || !narrow) return;
    acquireNavHeaderPopLock();
    return () => {
      releaseNavHeaderPopLock();
    };
  }, [open, narrow]);

  if (!ready || !open || !narrow) return null;

  return createPortal(
    <div
      className="nav-header-pop-backdrop"
      onClick={onClose}
      aria-hidden="true"
    />,
    document.body
  );
}
