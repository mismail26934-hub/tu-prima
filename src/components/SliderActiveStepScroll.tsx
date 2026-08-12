"use client";

import { useEffect } from "react";
import type { JobWithDetails } from "@/lib/types";

function isSliderMode() {
  return document.documentElement.classList.contains("active-job-slider-mode");
}

/** Scroll the steps list to the in-progress step when slider fullscreen is active. */
export function SliderActiveStepScroll({ job }: { job: JobWithDetails }) {
  const activeStepId = job.steps.find((s) => s.status === "in_progress")?.id;

  useEffect(() => {
    if (!isSliderMode()) return;

    const timer = window.setTimeout(() => {
      const target = activeStepId
        ? document.getElementById(`job-step-active-${job.id}`)
        : null;

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const steps = document.querySelector(
        `#job-${job.id} .steps`
      ) as HTMLElement | null;
      steps?.scrollTo({ top: 0, behavior: "smooth" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [job.id, activeStepId]);

  return null;
}
