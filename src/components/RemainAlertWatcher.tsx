"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { calcElapsedSec } from "@/lib/duration";
import type { JobWithDetails } from "@/lib/types";
import {
  isRemainAlertOwner,
  playRemainAlertWithSpeech,
  remainAlertTick,
  remainToneFor,
  stopRemainAlertForJob,
} from "@/lib/remain-alert-sound";
import { useRemainAlertStore } from "@/store/remainAlertStore";

/** Watches all loaded active jobs so speech is not limited to the visible page or slider card. */
export function RemainAlertWatcher({ jobs }: { jobs: JobWithDetails[] }) {
  const { data: session } = useSession();
  const userId = String(session?.user?.id || "");
  const muted = useRemainAlertStore((s) => s.muted);
  const pctStep = useRemainAlertStore((s) => s.pctStep);
  const overtimeHours = useRemainAlertStore((s) => s.overtimeHours);
  const hydrate = useRemainAlertStore((s) => s.hydrate);
  const [clock, setClock] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const id = window.setInterval(() => setClock((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const live = new Set(jobs.map((job) => job.id));
    for (const id of seenRef.current) {
      if (!live.has(id)) stopRemainAlertForJob(id);
    }
    seenRef.current = live;

    for (const job of jobs) {
      if (job.status === "done" || job.status === "cancelled") {
        stopRemainAlertForJob(job.id);
        continue;
      }
      if (!["in_progress", "paused"].includes(job.status)) continue;
      if (!isRemainAlertOwner(job, userId)) continue;
      const elapsed = calcElapsedSec(job);
      const estimateSec = Math.max(0, Number(job.estimated_minutes || 0) * 60);
      const remainingSec = estimateSec - elapsed;
      const remainingPct =
        estimateSec > 0 ? (Math.max(0, remainingSec) / estimateSec) * 100 : 0;
      const tone = remainToneFor(estimateSec, remainingSec, remainingPct);
      const next = remainAlertTick({
        jobId: job.id,
        status: job.status,
        tone,
        remainingPct,
        remainingSec,
        estimateSec,
        pctStep,
        overtimeMs: overtimeHours * 60 * 60 * 1000,
      });
      if (muted || !next) continue;
      playRemainAlertWithSpeech(
        next,
        job,
        remainingSec,
        remainingPct,
        estimateSec
      );
    }
  }, [jobs, clock, muted, userId, pctStep, overtimeHours]);

  return null;
}
