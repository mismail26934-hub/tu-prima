"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { JobListSection } from "@/lib/board-list";
import type { JobWithDetails } from "@/lib/types";

export type JobDeepLinkFocus = "" | "handover";

type LookupResponse = {
  job: JobWithDetails;
  section: JobListSection;
};

let lastDeepLinkScrollKey = "";

export function deepLinkScrollKey(
  jobId: string,
  focus: JobDeepLinkFocus
): string {
  return `${jobId}#${focus || "job"}`;
}

export function peekDeepLinkScrollKey(): string {
  return lastDeepLinkScrollKey;
}

export function markDeepLinkScrolled(key: string): void {
  lastDeepLinkScrollKey = key;
}

export function clearDeepLinkScroll(): void {
  lastDeepLinkScrollKey = "";
}

function readJobIdFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("job")?.trim() || "";
}

/** Customer share link: `/?job=…&view=customer` — read-only single job. */
export function readCustomerViewFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return (
    q.get("view")?.trim().toLowerCase() === "customer" &&
    Boolean(q.get("job")?.trim())
  );
}

export function useJobDeepLink() {
  const [jobId, setJobId] = useState("");
  const [customerView, setCustomerView] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [focus, setFocus] = useState<JobDeepLinkFocus>("");
  const [scrollGen, setScrollGen] = useState(0);
  const [section, setSection] = useState<JobListSection | null>(null);
  const [job, setJob] = useState<JobWithDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  useEffect(() => {
    const syncFromLocation = () => {
      setJobId(readJobIdFromLocation());
      setCustomerView(readCustomerViewFromLocation());
    };
    syncFromLocation();
    setLocationReady(true);
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("pageshow", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("pageshow", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!jobId) {
      setSection(null);
      setJob(null);
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
        setJob(data.job || null);
        setMissing(false);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSection(null);
        setJob(null);
        setMissing(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const clear = useCallback(() => {
    setJobId("");
    setCustomerView(false);
    setFocus("");
    setSection(null);
    setJob(null);
    setMissing(false);
    setReady(true);
    clearDeepLinkScroll();
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    url.searchParams.delete("view");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next);
  }, []);

  const open = useCallback((id: string, opts?: { focus?: JobDeepLinkFocus }) => {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    const nextFocus: JobDeepLinkFocus =
      opts?.focus === "handover" ? "handover" : "";
    const key = deepLinkScrollKey(nextId, nextFocus);
    if (peekDeepLinkScrollKey() === key) clearDeepLinkScroll();
    setFocus(nextFocus);
    setScrollGen((n) => n + 1);
    setCustomerView(false);
    if (jobIdRef.current !== nextId) {
      setJobId(nextId);
      setJob(null);
      setMissing(false);
      setReady(false);
    }
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", nextId);
    url.searchParams.delete("view");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, []);

  return {
    jobId,
    customerView,
    focus,
    scrollGen,
    section,
    job,
    missing,
    ready,
    locationReady,
    clear,
    open,
  };
}
