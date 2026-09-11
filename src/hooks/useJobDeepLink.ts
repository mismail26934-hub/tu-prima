"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { JobListSection } from "@/lib/board-list";
import type { JobWithDetails } from "@/lib/types";

type LookupResponse = {
  job: JobWithDetails;
  section: JobListSection;
};

function readJobIdFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("job")?.trim() || "";
}

export function useJobDeepLink() {
  const [jobId, setJobId] = useState("");
  const [section, setSection] = useState<JobListSection | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setJobId(readJobIdFromLocation());
  }, []);

  useEffect(() => {
    if (!jobId) {
      setSection(null);
      setMissing(false);
      setReady(true);
      return;
    }
    setReady(false);
    setMissing(false);
    let cancelled = false;
    api<LookupResponse>(`/api/jobs/${encodeURIComponent(jobId)}`)
      .then((data) => {
        if (cancelled) return;
        setSection(data.section);
        setMissing(false);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSection(null);
        setMissing(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const clear = useCallback(() => {
    setJobId("");
    setSection(null);
    setMissing(false);
    setReady(true);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next);
  }, []);

  return { jobId, section, missing, ready, clear };
}
