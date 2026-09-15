"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsRestoring } from "@tanstack/react-query";
import { signOut, useSession } from "next-auth/react";
import type {
  AppUserPublic,
  Attendance,
  AttendanceStatus,
  JobTemplate,
  JobTemplateCategory,
  JobWithDetails,
  PartLoanStatus,
  Technician,
  TechnicianStatus,
  Unit,
  UserLevel,
  DashboardData,
} from "@/lib/types";
import { JOB_PRIORITIES, USER_LEVELS, normalizeJobPriority } from "@/lib/types";
import {
  canAccess,
  canAssignJob,
  canAssignTechnicians,
  canDelegateJob,
  canDeleteJobNotes,
  canEditStepEvidence,
  canCompleteStep,
  canManageActiveJob,
  canManageJobProgress,
  canOperateJobProgress,
  canReopenJob,
  canSetTechnicianPresence,
  canWriteJobNotes,
  technicianIdForUser,
} from "@/lib/permissions";
import { calcElapsedSec, calcStepElapsedSec, formatDuration } from "@/lib/duration";
import {
  remainToneFor,
} from "@/lib/remain-alert-sound";
import {
  assignedTechnicianIds,
  displayStepTechnicianIds,
  stepTechnicianNames,
} from "@/lib/step-technicians";
import { downloadJobPdf } from "@/lib/job-pdf";
import { useAssignStore } from "@/store/assignStore";
import { useJobFormStore } from "@/store/jobFormStore";
import { useTechnicianBoardStore } from "@/store/technicianBoardStore";
import { useJobBoardStore } from "@/store/jobBoardStore";
import {
  useDashboardFiltersStore,
  resolveJobOwnershipFilter,
  type JobSectionFilter,
  type JobPriorityFilter,
  type TechStatusFilter,
} from "@/store/dashboardFiltersStore";
import { useT } from "@/i18n/useT";
import { LanguageToggle } from "@/components/LanguageToggle";
import { OfflineSyncChip } from "@/components/OfflineSyncChip";
import { NavAlerts } from "@/components/NavAlerts";
import { RemainAlertMuteToggle } from "@/components/RemainAlertMuteToggle";
import { RemainAlertWatcher } from "@/components/RemainAlertWatcher";
import { ActiveJobSlider, ActiveJobSliderToggle } from "@/components/ActiveJobSlider";
import { SliderActiveStepScroll } from "@/components/SliderActiveStepScroll";
import { SearchableSelect } from "@/components/SearchableSelect";
import { StepPhotoPicker } from "@/components/StepPhotoPicker";
import { StepNotePdfPicker } from "@/components/StepNotePdfPicker";
import { api } from "@/lib/api";
import { firstStepThumbUrl, stepHasPhoto, stepPhotoCount } from "@/lib/step-photo-url";
import {
  attachStepNotes,
  formatStepNoteAt,
  hydrateStepNotes,
  stepHasNote,
} from "@/lib/step-notes";
import { newEntityId } from "@/lib/offline/ids";
import { stepPhotoDisplayUrl } from "@/lib/offline/step-photo-preview";
import type { StepPhotoDraft } from "@/lib/step-photo-client";
import { compressAvatarFile } from "@/lib/step-photo-client";
import type { StepNotePdfDraft } from "@/lib/step-note-file-client";
import { useDashboard } from "@/hooks/useDashboard";
import { writeCachedSession } from "@/lib/offline/session-cache";
import {
  readBoardSnapshot,
  writeBoardSnapshot,
} from "@/lib/offline/board-snapshot";
import {
  useJobBackups,
  useMasterTemplates,
  useTemplateSummaries,
  useUsers,
  useForemen,
} from "@/hooks/useMasterQueries";
import {
  useJobActionMutation,
  useWorkshopClient,
} from "@/hooks/useWorkshopClient";
import {
  useActiveJobsSlider,
  useAssignTechnicianPool,
  useJobsList,
  useTechniciansList,
} from "@/hooks/useBoardLists";
import {
  useJobDeepLink,
  deepLinkScrollKey,
  peekDeepLinkScrollKey,
  markDeepLinkScrolled,
  clearDeepLinkScroll,
} from "@/hooks/useJobDeepLink";

type Modal =
  | null
  | { type: "create" }
  | { type: "edit"; job: JobWithDetails }
  | { type: "assign"; job: JobWithDetails }
  | {
      type: "tech-status";
      tech: Technician;
      nextStatus: Exclude<TechnicianStatus, "busy">;
    }
  | { type: "cancel-job"; job: JobWithDetails }
  | { type: "delete-job"; job: JobWithDetails }
  | { type: "pause-job"; job: JobWithDetails }
  | { type: "resume-job"; job: JobWithDetails }
  | { type: "start-job"; job: JobWithDetails }
  | {
      type: "start-steps";
      job: JobWithDetails;
      steps: JobWithDetails["steps"];
    }
  | { type: "start-next-step"; job: JobWithDetails; step: JobWithDetails["steps"][0] }
  | { type: "complete-step"; job: JobWithDetails; step: JobWithDetails["steps"][0] }
  | { type: "step-technicians"; job: JobWithDetails; step: JobWithDetails["steps"][0] }
  | { type: "step-note"; job: JobWithDetails; step: JobWithDetails["steps"][0] }
  | { type: "step-photo"; job: JobWithDetails; step: JobWithDetails["steps"][0] }
  | { type: "print-pdf"; job: JobWithDetails }
  | { type: "complete-job"; job: JobWithDetails }
  | { type: "delegate-job"; job: JobWithDetails }
  | { type: "reopen-job"; job: JobWithDetails }
    | {
      type: "handover-to";
      job: JobWithDetails;
      target: "draft" | { key: string };
      current: string;
      currentUserId: string;
    }
    | {
      type: "handover-delete";
      job: JobWithDetails;
      handoverKey: string;
      handoverId?: string;
      order: number;
      title: string;
    }
    | {
      type: "part-loan-delete";
      job: JobWithDetails;
      loanKey: string;
      loanId?: string;
      order: number;
      part_name: string;
    }
  | { type: "confirm-assign"; job: JobWithDetails; techIds: string[] }
  | { type: "units" }
  | {
      type: "unit-import-preview";
      rows: Array<{
        row: number;
        code: string;
        name: string;
        serial_number: string;
        active: "" | "1" | "0";
        ok: boolean;
        action: "create" | "update" | "skip";
        error?: string;
      }>;
      okCount: number;
      errorCount: number;
      selected: Record<number, boolean>;
    }
  | {
      type: "unit-form";
      mode: "create" | "edit";
      unit?: Unit;
    }
  | { type: "delete-unit"; unit: Unit }
  | { type: "templates" }
  | {
      type: "template-form";
      mode: "create" | "edit";
      template?: JobTemplate;
    }
  | {
      type: "delete-template";
      template: JobTemplate;
      permanent: boolean;
    }
  | { type: "techs" }
  | {
      type: "tech-import-preview";
      rows: Array<{
        row: number;
        name: string;
        sn: string;
        badge_id: string;
        email: string;
        phone: string;
        status: "" | "available" | "offline";
        ok: boolean;
        action: "create" | "update" | "skip";
        error?: string;
      }>;
      okCount: number;
      errorCount: number;
      selected: Record<number, boolean>;
    }
  | {
      type: "tech-form";
      mode: "create" | "edit";
      tech?: Technician;
    }
  | { type: "delete-tech"; tech: Technician }
  | { type: "attendance" }
  | {
      type: "attendance-form";
      mode: "create" | "edit";
      row?: Attendance;
    }
  | { type: "delete-attendance"; row: Attendance }
  | { type: "users" }
  | {
      type: "user-form";
      mode: "create" | "edit";
      user?: AppUserPublic;
    }
  | { type: "delete-user"; user: AppUserPublic }
  | { type: "change-password" }
  | { type: "edit-profile" }
  | { type: "logout" }
  | { type: "settings" }
  | { type: "export-jobs" }
  | { type: "export-jobs-confirm" }
  | { type: "job-backups" }
  | {
      type: "process-alert";
      title: string;
      message: string;
      phase: "loading" | "success" | "error";
    };

const HIDE_TECH_PANEL_KEY = "tus-hide-tech-panel";
const HIDE_JOB_PANEL_KEY = "tus-hide-job-panel";

function readBoolFlag(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

function writeBoolFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function userDisplayName(u: { name?: string; username: string }): string {
  return (u.name || "").trim() || u.username;
}

function jobTemplateCategoryLabel(category: JobTemplateCategory | string): string {
  if (category === "engine") return "Component Engine";
  if (category === "goh") return "GOH";
  return "Component Non Engine (Transmisi)";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="pill">
      <span className={`dot ${status}`} />
      {status.replace("_", " ")}
    </span>
  );
}

function LiveTimer({ job }: { job: JobWithDetails }) {
  const [sec, setSec] = useState(() => calcElapsedSec(job));
  useEffect(() => {
    setSec(calcElapsedSec(job));
    if (!["in_progress", "paused"].includes(job.status)) return;
    const id = setInterval(() => setSec(calcElapsedSec(job)), 1000);
    return () => clearInterval(id);
  }, [job]);
  return <div className="timer">{formatDuration(sec)}</div>;
}

/** Remaining vs estimate; card tone from remaining % of estimate. */
function RemainingTimerCard({ job }: { job: JobWithDetails }) {
  const t = useT();
  const [elapsed, setElapsed] = useState(() => calcElapsedSec(job));
  useEffect(() => {
    setElapsed(calcElapsedSec(job));
    if (!["in_progress", "paused"].includes(job.status)) return;
    const id = setInterval(() => setElapsed(calcElapsedSec(job)), 1000);
    return () => clearInterval(id);
  }, [job]);

  const estimateSec = Math.max(0, Number(job.estimated_minutes || 0) * 60);
  const remainingSec = estimateSec - elapsed;
  const remainingPct =
    estimateSec > 0 ? (Math.max(0, remainingSec) / estimateSec) * 100 : 0;
  const tone = remainToneFor(estimateSec, remainingSec, remainingPct);

  const value =
    remainingSec >= 0
      ? formatDuration(remainingSec)
      : `-${formatDuration(Math.abs(remainingSec))}`;

  const pctLabel =
    estimateSec <= 0
      ? "—"
      : remainingSec >= 0
        ? `${remainingPct.toFixed(1)}%`
        : "0.0%";

  const shouldPulse =
    job.status !== "done" &&
    job.status !== "cancelled" &&
    tone !== "green";

  return (
    <div
      className={`remain-card remain-card--${tone}${shouldPulse ? " remain-card--pulse" : ""}`}
      title={
        estimateSec > 0
          ? t("job.remainTitleTip", {
              pct: Math.max(0, remainingPct).toFixed(1),
              minutes: job.estimated_minutes,
              minUnit: t("common.minutes"),
            })
          : t("job.remainNoEstimate")
      }
    >
      <span className="remain-card-label">{t("job.remainTitle")}</span>
      <span className="remain-card-value">{value}</span>
      <span className="remain-card-pct">
        {pctLabel} {t("common.remainingPct")}
      </span>
    </div>
  );
}

function StepDuration({ step, running }: { step: JobWithDetails["steps"][0]; running: boolean }) {
  const t = useT();
  const [sec, setSec] = useState(() => calcStepElapsedSec(step));
  useEffect(() => {
    setSec(calcStepElapsedSec(step));
    if (!running || step.status !== "in_progress") return;
    const id = setInterval(() => setSec(calcStepElapsedSec(step)), 1000);
    return () => clearInterval(id);
  }, [step, running]);
  if (step.status === "pending") return <span style={{ color: "var(--muted)" }}>—</span>;

  const stdSec = Math.max(0, Number(step.std_minutes || 0) * 60);
  const remainingSec = stdSec - sec;
  const remainingPct =
    stdSec > 0 ? (Math.max(0, remainingSec) / stdSec) * 100 : 0;

  // Hijau: sisa ≥50% · Oranye: 20% < sisa < 50% · Merah: sisa ≤20% atau overtime
  let tone: "green" | "orange" | "red" | null = null;
  if (stdSec > 0) {
    if (remainingSec <= 0 || remainingPct <= 20) tone = "red";
    else if (remainingPct >= 50) tone = "green";
    else tone = "orange";
  }

  return (
    <span
      className={tone ? `step-duration step-duration--${tone}` : "step-duration"}
      title={
        stdSec > 0
          ? remainingSec >= 0
            ? t("job.stpRemainTip", {
                pct: remainingPct.toFixed(1),
                minutes: step.std_minutes,
                minUnit: t("common.minutes"),
              })
            : t("job.stpOverTip", {
                minutes: step.std_minutes,
                minUnit: t("common.minutes"),
              })
          : undefined
      }
    >
      {formatDuration(sec)}
    </span>
  );
}

function PanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

type StatIconKind =
  | "available"
  | "busy"
  | "offline"
  | "active"
  | "queue"
  | "done";

function StatIcon({ kind }: { kind: StatIconKind }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "available":
      return (
        <svg {...common}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "busy":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "offline":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 19c1.4-3 3.6-4.5 6.5-4.5S17.1 16 18.5 19" />
          <path d="M4 4l16 16" />
        </svg>
      );
    case "active":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "queue":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "done":
      return (
        <svg {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
      );
  }
}

function BusyOverlay({ label = "Memproses..." }: { label?: string }) {
  return (
    <div className="modal-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function ShimmerBlock({ className = "" }: { className?: string }) {
  return <span className={`shimmer-block ${className}`.trim()} aria-hidden="true" />;
}

function DashboardShimmer({ label }: { label: string }) {
  return (
    <div className="dashboard-shimmer" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="summary-wrap" aria-hidden="true">
        {[0, 1].map((group) => (
          <section key={group} className="summary-group">
            <ShimmerBlock className="shimmer-block--title" />
            <div className="summary">
              {[0, 1, 2].map((i) => (
                <div key={i} className="stat shimmer-stat">
                  <ShimmerBlock className="shimmer-block--label" />
                  <ShimmerBlock className="shimmer-block--value" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="grid" aria-hidden="true">
        {[0, 1].map((panel) => (
          <section key={panel} className="panel shimmer-panel">
            <div className="shimmer-panel-head">
              <ShimmerBlock className="shimmer-block--heading" />
              <ShimmerBlock className="shimmer-block--search" />
            </div>
            <div className="shimmer-list">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="shimmer-card">
                  <ShimmerBlock className="shimmer-block--line shimmer-block--line-lg" />
                  <ShimmerBlock className="shimmer-block--line" />
                  <ShimmerBlock className="shimmer-block--line shimmer-block--line-sm" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function BusyLabel({
  busy,
  idle,
  pending = "Memproses...",
}: {
  busy: boolean;
  idle: string;
  pending?: string;
}) {
  if (!busy) return <>{idle}</>;
  return (
    <span className="btn-busy">
      <span className="spinner spinner--sm" aria-hidden="true" />
      {pending}
    </span>
  );
}

/** Build page list like: 1 2 3 … 100 or 1 … 4 5 6 … 100 */
function getPagerItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | "…"> = [];
  const pushUnique = (n: number | "…") => {
    if (items[items.length - 1] !== n) items.push(n);
  };

  pushUnique(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pushUnique("…");
  for (let i = start; i <= end; i++) pushUnique(i);
  if (end < total - 1) pushUnique("…");
  pushUnique(total);
  return items;
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const items = getPagerItems(page, totalPages);
  return (
    <div className="pager">
      <button
        type="button"
        className="btn pager-nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Halaman sebelumnya"
        title="Prev"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="pager-pages">
        {items.map((item, idx) =>
          item === "…" ? (
            <span key={`e-${idx}`} className="pager-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`btn pager-page${item === page ? " is-active" : ""}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        className="btn pager-nav"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Halaman berikutnya"
        title="Next"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

/** Prev/next pager for large archive lists (keyset cursor, no page jump). */
function ArchivePager({
  page,
  total,
  totalPages,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= 0) return null;
  if (totalPages <= 1 && !hasNext && page <= 1) return null;
  return (
    <div className="pager">
      <button
        type="button"
        className="btn pager-nav"
        disabled={page <= 1}
        onClick={onPrev}
        aria-label="Halaman sebelumnya"
        title="Prev"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span className="pager-meta" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
        {page} / {totalPages} · {total} job
      </span>
      <button
        type="button"
        className="btn pager-nav"
        disabled={!hasNext}
        onClick={onNext}
        aria-label="Halaman berikutnya"
        title="Next"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

function MetaIcon({ children }: { children: string }) {
  return (
    <span className="meta-icon" aria-hidden>
      {children}
    </span>
  );
}

function PersonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AccountAvatar({ url, size = 28 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (!url || failed) {
    return (
      <span
        className="nav-avatar"
        style={{
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
        }}
      >
        <PersonIcon size={Math.max(14, Math.round(size * 0.55))} />
      </span>
    );
  }
  return (
    <img
      className="nav-avatar"
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}

export default function HomePage() {
  const t = useT();
  const { data: session, status: sessionStatus, update: updateSession } = useSession();
  const isLoggedIn = sessionStatus === "authenticated";
  const userLevel = session?.user?.level || "guest";
  const userId = String(session?.user?.id || "");
  const showNavAlerts = userLevel === "foreman" || userLevel === "teknisi";
  const [myTechnicianId, setMyTechnicianId] = useState("");
  const canJobCreate = canAccess(userLevel, "job", "create");
  const canJobUpdate = canAccess(userLevel, "job", "update");
  const canJobDelete = canAccess(userLevel, "job", "delete");
  const canJobAssign = canAssignJob(userLevel);
  const canJobProgress = canManageJobProgress(userLevel);
  const canJobReopen = canReopenJob(userLevel);
  const canUserCreate = canAccess(userLevel, "user", "create");
  const canUserUpdate = canAccess(userLevel, "user", "update");
  const canUserDelete = canAccess(userLevel, "user", "delete");
  const canTechCreate = canAccess(userLevel, "technician", "create");
  const canTechUpdate = canAccess(userLevel, "technician", "update");
  const canSetTechPresence = canSetTechnicianPresence(userLevel);
  const canTechDelete = canAccess(userLevel, "technician", "delete");
  const canUnitRead = canAccess(userLevel, "unit", "read");
  const canUnitCreate = canAccess(userLevel, "unit", "create");
  const canUnitUpdate = canAccess(userLevel, "unit", "update");
  const canUnitDelete = canAccess(userLevel, "unit", "delete");
  const canTemplateRead = canAccess(userLevel, "template", "read");
  const canTemplateCreate = canAccess(userLevel, "template", "create");
  const canTemplateUpdate = canAccess(userLevel, "template", "update");
  const canTemplateDelete = canAccess(userLevel, "template", "delete");
  const canAttendanceCreate = canAccess(userLevel, "attendance", "create");
  const canAttendanceUpdate = canAccess(userLevel, "attendance", "update");
  const canAttendanceDelete = canAccess(userLevel, "attendance", "delete");

  function jobAssigneeCount(job: JobWithDetails): number {
    return job.technicians?.length ?? 0;
  }

  function canManageJob(job: JobWithDetails): boolean {
    return canManageActiveJob(
      userLevel,
      userId,
      job,
      jobAssigneeCount(job)
    );
  }

  function canAssignForJob(job: JobWithDetails): boolean {
    return canAssignTechnicians(
      userLevel,
      userId,
      job,
      jobAssigneeCount(job)
    );
  }

  function canProgressForJob(job: JobWithDetails): boolean {
    return canOperateJobProgress(
      userLevel,
      userId,
      job,
      jobAssigneeCount(job)
    );
  }

  function actorTechnicianIdForJob(job: JobWithDetails): string {
    return (
      myTechnicianId ||
      technicianIdForUser(userId, job.technicians || []) ||
      technicianIdForUser(userId, job.technician_index || [])
    );
  }

  function canEvidenceForStep(
    job: JobWithDetails,
    step: JobWithDetails["steps"][0]
  ): boolean {
    return canEditStepEvidence(
      userLevel,
      userId,
      job,
      step,
      assignedTechnicianIds(job),
      actorTechnicianIdForJob(job),
      jobAssigneeCount(job)
    );
  }

  function canCompleteForStep(
    job: JobWithDetails,
    step: JobWithDetails["steps"][0]
  ): boolean {
    return canCompleteStep(
      userLevel,
      userId,
      job,
      step,
      assignedTechnicianIds(job),
      actorTechnicianIdForJob(job),
      jobAssigneeCount(job)
    );
  }

  function canNotesWriteForJob(job: JobWithDetails): boolean {
    if (job.from_archive) return false;
    return canWriteJobNotes(
      userLevel,
      userId,
      job,
      assignedTechnicianIds(job),
      actorTechnicianIdForJob(job),
      jobAssigneeCount(job)
    );
  }

  function canNotesDeleteForJob(job: JobWithDetails): boolean {
    if (job.from_archive) return false;
    return canDeleteJobNotes(
      userLevel,
      userId,
      job,
      jobAssigneeCount(job)
    );
  }

  function canDelegateForJob(job: JobWithDetails): boolean {
    return (
      canDelegateJob(userLevel, userId, job) &&
      Boolean(job.assigned_by_user_id)
    );
  }

  function canDeleteForJob(job: JobWithDetails): boolean {
    return canJobDelete && canManageJob(job);
  }

  const displayName = session?.user?.name || session?.user?.email || "";
  const displayNameShort = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return displayName;
    return parts.map((part) => part[0]?.toUpperCase() || "").join("");
  })();
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const modalJob =
    modal && "job" in modal
      ? (modal as { job: JobWithDetails }).job
      : null;
  const modalProgressOk = modalJob ? canProgressForJob(modalJob) : false;
  const modalEvidenceOk =
    modalJob && modal && "step" in modal
      ? canEvidenceForStep(
          modalJob,
          (modal as { step: JobWithDetails["steps"][0] }).step
        )
      : false;
  const modalCompleteOk =
    modal?.type === "complete-step"
      ? canCompleteForStep(modal.job, modal.step)
      : false;
  const modalManageOk = modalJob ? canManageJob(modalJob) : false;
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [exportForm, setExportForm] = useState<{
    scope: "active" | "queue";
    dateField: "created" | "started" | "completed";
    dateFrom: string;
    dateTo: string;
  }>({
    scope: "active",
    dateField: "created",
    dateFrom: "",
    dateTo: "",
  });
  const [jobBackupsIncludeUndone, setJobBackupsIncludeUndone] = useState(false);
  const [delegateForemanId, setDelegateForemanId] = useState("");
  const [foremanOptions, setForemanOptions] = useState<AppUserPublic[]>([]);
  const [handoverRecipientOptions, setHandoverRecipientOptions] = useState<
    AppUserPublic[]
  >([]);
  const [handoverToQuery, setHandoverToQuery] = useState("");
  const [handoverToPage, setHandoverToPage] = useState(1);
  const [handoverToLoading, setHandoverToLoading] = useState(false);
  const [assignPickerPage, setAssignPickerPage] = useState(1);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [unitForm, setUnitForm] = useState({
    code: "",
    name: "",
    serial_number: "",
    active: "1",
  });
  const [unitDraft, setUnitDraft] = useState("");
  const [unitQuery, setUnitQuery] = useState("");
  const [unitImportMsg, setUnitImportMsg] = useState("");
  const templatesModalOpen =
    modal?.type === "templates" ||
    modal?.type === "template-form" ||
    modal?.type === "delete-template";
  const usersModalOpen =
    modal?.type === "users" ||
    modal?.type === "user-form" ||
    modal?.type === "delete-user";
  const backupsModalOpen = modal?.type === "job-backups";
  const formMode = useJobFormStore((s) => s.form.mode);
  const formCategory = useJobFormStore((s) => s.form.category);

  const persistRestoring = useIsRestoring();
  const {
    data: queryData,
    error: dashboardError,
    isFetching: dashboardFetching,
  } = useDashboard();
  const [snapDash, setSnapDash] = useState<DashboardData | undefined>();
  useEffect(() => {
    setSnapDash(readBoardSnapshot()?.dashboard);
  }, []);
  useEffect(() => {
    if (queryData) writeBoardSnapshot({ dashboard: queryData });
  }, [queryData]);
  const data = queryData ?? snapDash;
  const refreshDashboard = useCallback(() => {
    window.location.reload();
  }, []);
  const {
    invalidateDashboard,
    invalidateTemplates,
    invalidateUsers,
    invalidateBackups,
    fetchTemplate,
  } = useWorkshopClient();
  const jobActionMutation = useJobActionMutation();
  const { data: masterTemplatesRes, isLoading: templatesMasterLoading } =
    useMasterTemplates(canTemplateRead && templatesModalOpen);
  const masterTemplates = masterTemplatesRes?.templates || [];
  const { data: appUsers = [], isLoading: usersLoading } = useUsers(
    usersModalOpen && userLevel === "superuser"
  );
  const { data: foremanPicker = [], isLoading: foremenLoading } = useForemen(
    modal?.type === "tech-form"
  );
  const {
    data: jobBackups = [],
    isLoading: backupsLoading,
    isFetching: backupsFetching,
    refetch: refetchBackups,
  } = useJobBackups(
    jobBackupsIncludeUndone,
    backupsModalOpen && userLevel === "superuser"
  );
  const { data: templateSummariesRes, isFetching: templatesLoading } =
    useTemplateSummaries(formCategory || undefined);
  const templateSummaries = templateSummariesRes?.templates || [];
  const [templateForm, setTemplateForm] = useState<{
    category: JobTemplateCategory;
    name: string;
    active: string;
    steps: Array<{
      id?: string;
      phase: string;
      name: string;
      order: number;
      man_power: number;
      std_minutes: number;
    }>;
  }>({
    category: "engine",
    name: "",
    active: "1",
    steps: [{ phase: "", name: "", order: 1, man_power: 1, std_minutes: 60 }],
  });
  const [templateCloneId, setTemplateCloneId] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<
    "" | JobTemplateCategory
  >("");
  const [templateMasterPage, setTemplateMasterPage] = useState(1);
  const [templateImportMsg, setTemplateImportMsg] = useState("");
  const [techForm, setTechForm] = useState({
    name: "",
    sn: "",
    badge_id: "",
    email: "",
    phone: "",
    status: "available" as Exclude<TechnicianStatus, "busy">,
    superior_user_id: "",
  });
  const [masterTechDraft, setMasterTechDraft] = useState("");
  const [masterTechQuery, setMasterTechQuery] = useState("");
  const [techImportMsg, setTechImportMsg] = useState("");
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    phone: "",
    level: "teknisi" as UserLevel,
    active: "1",
  });
  const [masterUserDraft, setMasterUserDraft] = useState("");
  const [masterUserQuery, setMasterUserQuery] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordChangeMsg, setPasswordChangeMsg] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [profileChangeMsg, setProfileChangeMsg] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<{
    previewUrl: string;
    base64: string;
    mime: string;
  } | null>(null);
  const [profilePhotoRemoved, setProfilePhotoRemoved] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [hideTechPanel, setHideTechPanel] = useState(false);
  const [hideJobPanel, setHideJobPanel] = useState(false);
  const topbarRef = useRef<HTMLElement>(null);
  const manageRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  const [topbarHeightPx, setTopbarHeightPx] = useState(0);
  const [glassPortalReady, setGlassPortalReady] = useState(false);

  useEffect(() => {
    if (!manageOpen) return;
    function onDocClick(e: MouseEvent) {
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) {
        setManageOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setManageOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [manageOpen]);

  useEffect(() => {
    if (!sessionOpen || mobileMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (sessionRef.current && !sessionRef.current.contains(e.target as Node)) {
        setSessionOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSessionOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [sessionOpen, mobileMenuOpen]);

  useEffect(() => {
    if (!isLoggedIn || !userId) {
      setAvatarUrl("");
      setMyTechnicianId("");
      return;
    }
    let cancelled = false;
    void api<AppUserPublic>("/api/account/profile")
      .then((me) => {
        if (cancelled) return;
        setAvatarUrl(me.photo_url || "");
        setMyTechnicianId(me.technician_id || "");
      })
      .catch(() => {
        if (cancelled) return;
        setAvatarUrl("");
        setMyTechnicianId("");
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userId]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setManageOpen(false);
      setSessionOpen(false);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (modal) {
      setManageOpen(false);
      setSessionOpen(false);
    }
  }, [modal]);

  useEffect(() => {
    setGlassPortalReady(true);
  }, []);

  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const sync = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      const bottom = Math.ceil(el.getBoundingClientRect().bottom);
      const scrollY =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      const scrolled = scrollY > 4;
      document.documentElement.style.setProperty(
        "--topbar-height",
        `${height}px`
      );
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
      el.classList.toggle("is-scrolled", scrolled);
      setTopbarScrolled(scrolled);
      setTopbarHeightPx(height);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync);
    };
  }, []);

  useEffect(() => {
    const open = modal != null;
    document.documentElement.classList.toggle("modal-open", open);
    const el = topbarRef.current;
    if (open && el) {
      const bottom = Math.ceil(el.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
    }
    return () => {
      document.documentElement.classList.remove("modal-open");
    };
  }, [modal]);

  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", mobileMenuOpen);
    if (mobileMenuOpen && topbarRef.current) {
      const bottom = Math.ceil(topbarRef.current.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
    }
    return () => {
      document.documentElement.classList.remove("menu-open");
    };
  }, [mobileMenuOpen]);

  function openUnitCreate() {
    setUnitForm({ code: "", name: "", serial_number: "", active: "1" });
    setModal({ type: "unit-form", mode: "create" });
  }

  function openUnitEdit(unit: Unit) {
    setUnitForm({
      code: unit.code,
      name: unit.name,
      serial_number: unit.serial_number || "",
      active: unit.active,
    });
    setModal({ type: "unit-form", mode: "edit", unit });
  }

  async function saveUnit() {
    if (modal?.type !== "unit-form") return;
    setBusy(true);
    setError("");
    try {
      if (modal.mode === "create") {
        await api("/api/units", {
          method: "POST",
          body: JSON.stringify({
            code: unitForm.code,
            name: unitForm.name,
            serial_number: unitForm.serial_number,
          }),
        });
      } else if (modal.unit) {
        await api(`/api/units/${modal.unit.id}`, {
          method: "PATCH",
          body: JSON.stringify(unitForm),
        });
      }
      setModal({ type: "units" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan unit");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUnit() {
    if (modal?.type !== "delete-unit") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/units/${modal.unit.id}`, { method: "DELETE" });
      setModal({ type: "units" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus unit");
    } finally {
      setBusy(false);
    }
  }

  async function importUnitsFile(file: File) {
    setBusy(true);
    setError("");
    setUnitImportMsg("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api<{
        rows: Array<{
          row: number;
          code: string;
          name: string;
          serial_number: string;
          active: "" | "1" | "0";
          ok: boolean;
          action: "create" | "update" | "skip";
          error?: string;
        }>;
        okCount: number;
        errorCount: number;
      }>("/api/units/import", { method: "POST", body: formData });
      const selected: Record<number, boolean> = {};
      for (const row of result.rows) {
        if (row.ok) selected[row.row] = true;
      }
      setModal({
        type: "unit-import-preview",
        rows: result.rows,
        okCount: result.okCount,
        errorCount: result.errorCount,
        selected,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import unit gagal");
    } finally {
      setBusy(false);
    }
  }

  async function commitUnitImportPreview() {
    if (modal?.type !== "unit-import-preview") return;
    const rows = modal.rows
      .filter((r) => r.ok && modal.selected[r.row])
      .map((r) => ({
        code: r.code,
        name: r.name,
        serial_number: r.serial_number,
        active: r.active,
        action: r.action === "update" ? ("update" as const) : ("create" as const),
      }));
    if (!rows.length) {
      setError("Pilih minimal satu baris OK untuk diimpor");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        imported: number;
        updated: number;
        skipped: string[];
      }>("/api/units/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      setUnitImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.skipped.length
            ? ` · ${result.skipped.length} baris dilewati`
            : "")
      );
      setModal({ type: "units" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import unit gagal");
    } finally {
      setBusy(false);
    }
  }

  function openTemplatesMaster() {
    setTemplateDraft("");
    setTemplateQuery("");
    setTemplateCategoryFilter("");
    setTemplateMasterPage(1);
    setTemplateImportMsg("");
    setError("");
    setModal({ type: "templates" });
  }

  function blankTemplateSteps() {
    return [{ phase: "", name: "", order: 1, man_power: 1, std_minutes: 60 }];
  }

  function openTemplateCreate() {
    setTemplateCloneId("");
    setTemplateForm({
      category: "engine",
      name: "",
      active: "1",
      steps: blankTemplateSteps(),
    });
    setModal({ type: "template-form", mode: "create" });
  }

  function openTemplateEdit(template: JobTemplate) {
    setTemplateCloneId("");
    setTemplateForm({
      category: template.category,
      name: template.name,
      active: template.active || "1",
      steps: (template.steps || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          id: s.id,
          phase: s.phase || "",
          name: s.name,
          order: s.order,
          man_power: Number(s.man_power) || 0,
          std_minutes: Number(s.std_minutes) || 0,
        })),
    });
    setModal({ type: "template-form", mode: "edit", template });
  }

  async function applyTemplateClone(sourceId: string) {
    setTemplateCloneId(sourceId);
    if (!sourceId) {
      setTemplateForm((prev) => ({ ...prev, steps: blankTemplateSteps() }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const tpl = await fetchTemplate(sourceId, true);
      setTemplateForm((prev) => ({
        ...prev,
        category: tpl.category,
        name: prev.name || `${tpl.name} (copy)`,
        steps: (tpl.steps || [])
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((s, i) => ({
            phase: s.phase || "",
            name: s.name,
            order: i + 1,
            man_power: Number(s.man_power) || 0,
            std_minutes: Number(s.std_minutes) || 0,
          })),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal salin template");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (modal?.type !== "template-form") return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        category: templateForm.category,
        name: templateForm.name,
        active: templateForm.active,
        steps: templateForm.steps.map((s, i) => ({
          id: s.id,
          phase: s.phase,
          name: s.name,
          order: s.order || i + 1,
          man_power: s.man_power,
          std_minutes: s.std_minutes,
        })),
      };
      if (modal.mode === "create") {
        await api("/api/job-templates", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal.template) {
        await api(`/api/job-templates/${modal.template.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setModal({ type: "templates" });
      await invalidateTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan template");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteTemplate() {
    if (modal?.type !== "delete-template") return;
    setBusy(true);
    setError("");
    const tpl = modal.template;
    const permanent = modal.permanent;
    try {
      if (permanent) {
        await api(`/api/job-templates/${tpl.id}`, { method: "DELETE" });
      } else {
        await api(`/api/job-templates/${tpl.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            category: tpl.category,
            name: tpl.name,
            active: "0",
            steps: tpl.steps,
          }),
        });
      }
      setModal({ type: "templates" });
      await invalidateTemplates();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : permanent
            ? "Gagal hapus template"
            : "Gagal nonaktifkan template"
      );
    } finally {
      setBusy(false);
    }
  }

  async function importTemplatesFile(file: File) {
    setBusy(true);
    setError("");
    setTemplateImportMsg("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api<{
        imported: number;
        updated: number;
        skipped: string[];
      }>("/api/job-templates/import", { method: "POST", body: formData });
      setTemplateImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.skipped.length
            ? ` · ${result.skipped.length} baris dilewati`
            : "")
      );
      await invalidateTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import template gagal");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplateUploadExcel() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/job-templates/template", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Gagal unduh template (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "template-upload-job-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal unduh template Excel");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplatesDataExcel(opts?: {
    id?: string;
    category?: "" | JobTemplateCategory;
  }) {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (opts?.id) params.set("id", opts.id);
      else if (opts?.category) params.set("category", opts.category);
      const qs = params.toString();
      const res = await fetch(
        `/api/job-templates/download${qs ? `?${qs}` : ""}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Gagal unduh Excel (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const matched = disposition.match(/filename="([^"]+)"/i);
      const filename =
        matched?.[1] ||
        (opts?.id
          ? `job-template-${opts.id}.xlsx`
          : opts?.category
            ? `job-templates-${opts.category}.xlsx`
            : "job-templates.xlsx");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal unduh Excel data template");
    } finally {
      setBusy(false);
    }
  }

  function openTechCreate() {
    setTechForm({
      name: "",
      sn: "",
      badge_id: "",
      email: "",
      phone: "",
      status: "available",
      superior_user_id: "",
    });
    setModal({ type: "tech-form", mode: "create" });
  }

  function openTechEdit(tech: Technician) {
    setTechForm({
      name: tech.name,
      sn: tech.sn,
      badge_id: tech.badge_id || "",
      email: tech.email || "",
      phone: tech.phone || "",
      status: tech.status === "offline" ? "offline" : "available",
      superior_user_id: tech.superior_user_id || "",
    });
    setModal({ type: "tech-form", mode: "edit", tech });
  }

  async function saveTech() {
    if (modal?.type !== "tech-form") return;
    if (
      !techForm.name.trim() ||
      !techForm.sn.trim() ||
      !techForm.badge_id.trim() ||
      !techForm.email.trim() ||
      !techForm.phone.trim()
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: techForm.name,
        sn: techForm.sn,
        badge_id: techForm.badge_id,
        email: techForm.email,
        phone: techForm.phone,
        superior_user_id: techForm.superior_user_id,
        ...(modal.tech?.status === "busy" ? {} : { status: techForm.status }),
      };
      if (modal.mode === "create") {
        await api("/api/technicians", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal.tech) {
        await api(`/api/technicians/${modal.tech.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setModal({ type: "techs" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan teknisi");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteTech() {
    if (modal?.type !== "delete-tech") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/technicians/${modal.tech.id}`, { method: "DELETE" });
      setModal({ type: "techs" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus teknisi");
    } finally {
      setBusy(false);
    }
  }

  async function importTechniciansFile(file: File) {
    setBusy(true);
    setError("");
    setTechImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<{
        rows: Array<{
          row: number;
          name: string;
          sn: string;
          badge_id: string;
          email: string;
          phone: string;
          status: "" | "available" | "offline";
          ok: boolean;
          action: "create" | "update" | "skip";
          error?: string;
        }>;
        okCount: number;
        errorCount: number;
      }>("/api/technicians/import", { method: "POST", body: fd });
      const selected: Record<number, boolean> = {};
      for (const row of result.rows) {
        if (row.ok) selected[row.row] = true;
      }
      setModal({
        type: "tech-import-preview",
        rows: result.rows,
        okCount: result.okCount,
        errorCount: result.errorCount,
        selected,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import teknisi gagal");
    } finally {
      setBusy(false);
    }
  }

  async function commitTechnicianImportPreview() {
    if (modal?.type !== "tech-import-preview") return;
    const rows = modal.rows
      .filter((r) => r.ok && modal.selected[r.row])
      .map((r) => ({
        name: r.name,
        sn: r.sn,
        badge_id: r.badge_id,
        email: r.email,
        phone: r.phone,
        status: r.status,
        action: r.action === "update" ? ("update" as const) : ("create" as const),
      }));
    if (!rows.length) {
      setError("Pilih minimal satu baris OK untuk diimpor");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        imported: number;
        updated: number;
        skipped: string[];
      }>("/api/technicians/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      setTechImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.skipped.length
            ? ` · ${result.skipped.length} baris dilewati`
            : "")
      );
      setModal({ type: "techs" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import teknisi gagal");
    } finally {
      setBusy(false);
    }
  }

  function openUsersMaster() {
    if (userLevel !== "superuser") {
      setError("Master User hanya untuk superuser");
      return;
    }
    setError("");
    setMasterUserDraft("");
    setMasterUserQuery("");
    setModal({ type: "users" });
  }

  function openUserCreate() {
    setUserForm({
      username: "",
      password: "",
      name: "",
      email: "",
      phone: "",
      level: "teknisi",
      active: "1",
    });
    setModal({ type: "user-form", mode: "create" });
  }

  function openUserEdit(user: AppUserPublic) {
    setUserForm({
      username: user.username,
      password: "",
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      level: user.level,
      active: user.active,
    });
    setModal({ type: "user-form", mode: "edit", user });
  }

  async function saveUser() {
    if (modal?.type !== "user-form") return;
    if (!userForm.username.trim()) return;
    if (modal.mode === "create" && !userForm.password) return;
    setBusy(true);
    setError("");
    try {
      if (modal.mode === "create") {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: userForm.username,
            password: userForm.password,
            name: userForm.name,
            email: userForm.email,
            phone: userForm.phone,
            level: userForm.level,
            active: userForm.active,
          }),
        });
      } else if (modal.user) {
        await api(`/api/users/${modal.user.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: userForm.username,
            name: userForm.name,
            email: userForm.email,
            phone: userForm.phone,
            level: userForm.level,
            active: userForm.active,
            ...(userForm.password ? { password: userForm.password } : {}),
          }),
        });
      }
      await invalidateUsers();
      setModal({ type: "users" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan user");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUser() {
    if (modal?.type !== "delete-user") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/users/${modal.user.id}`, { method: "DELETE" });
      await invalidateUsers();
      setModal({ type: "users" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus user");
    } finally {
      setBusy(false);
    }
  }

  function openAttendanceCreate() {
    const today = new Date().toISOString().slice(0, 10);
    setAttendanceForm({
      date: attendanceDateFilter || today,
      technician_id: "",
      technician_name: "",
      pernr: "",
      status: "hadir",
      dws: "",
      check_in: "",
      check_out: "",
      absence: "",
      note: "",
    });
    setModal({ type: "attendance-form", mode: "create" });
  }

  function openAttendanceEdit(row: Attendance) {
    setAttendanceForm({
      date: row.date,
      technician_id: row.technician_id,
      technician_name: row.technician_name,
      pernr: row.pernr,
      status: row.status,
      dws: row.dws,
      check_in: row.check_in,
      check_out: row.check_out,
      absence: row.absence,
      note: row.note,
    });
    setModal({ type: "attendance-form", mode: "edit", row });
  }

  async function saveAttendance() {
    if (modal?.type !== "attendance-form") return;
    if (!attendanceForm.date || !attendanceForm.technician_name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...attendanceForm,
        technician_name: attendanceForm.technician_name.trim(),
        pernr: attendanceForm.pernr.trim(),
      };
      if (modal.mode === "create") {
        await api("/api/attendance", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modal.row) {
        await api(`/api/attendance/${modal.row.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setModal({ type: "attendance" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan daftar hadir");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAttendance() {
    if (modal?.type !== "delete-attendance") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/attendance/${modal.row.id}`, { method: "DELETE" });
      setModal({ type: "attendance" });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus daftar hadir");
    } finally {
      setBusy(false);
    }
  }

  async function importAttendanceFile(file: File) {
    setBusy(true);
    setError("");
    setAttendanceImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append(
        "sync_tech_status",
        attendanceSyncTech && canTechUpdate ? "1" : "0"
      );
      const result = await api<{
        imported: number;
        updated: number;
        unmatched: string[];
        date: string;
        tech_available?: number;
        tech_offline?: number;
      }>("/api/attendance/import", { method: "POST", body: fd });
      if (result.date) setAttendanceDateFilter(result.date);
      setAttendanceImportMsg(
        `Import OK: ${result.imported} baru, ${result.updated} diupdate` +
          (result.unmatched.length
            ? ` · ${result.unmatched.length} tidak match teknisi`
            : "") +
          (typeof result.tech_offline === "number"
            ? ` · status: ${result.tech_available ?? 0} available, ${result.tech_offline} offline`
            : "")
      );
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import gagal");
    } finally {
      setBusy(false);
    }
  }

  async function syncMealsPresence(opts?: { file?: File }) {
    setBusy(true);
    setError("");
    setAttendanceImportMsg("");
    try {
      let result: {
        available: number;
        offline: number;
        busy_skipped: number;
        badge_count: number;
        unmatched_badges: string[];
        attendance_upserted: number;
        date: string;
        sheet_used?: string;
        rule?: string;
      };
      if (opts?.file) {
        const fd = new FormData();
        fd.append("file", opts.file);
        if (attendanceDateFilter) fd.append("date", attendanceDateFilter);
        result = await api("/api/attendance/sync-sharepoint", {
          method: "POST",
          body: fd,
        });
      } else {
        result = await api("/api/attendance/sync-sharepoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: attendanceDateFilter || undefined,
          }),
        });
      }
      if (result.date) setAttendanceDateFilter(result.date);
      setAttendanceImportMsg(
        `Meals/presence OK: ${result.available} available, ${result.offline} offline` +
          (result.busy_skipped ? ` · ${result.busy_skipped} busy di-skip` : "") +
          ` · ${result.badge_count} badge di Excel` +
          (result.unmatched_badges?.length
            ? ` · ${result.unmatched_badges.length} badge belum ada di master`
            : "") +
          (result.sheet_used ? ` · sheet: ${result.sheet_used}` : "")
      );
      await invalidateDashboard();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sync meals / kehadiran gagal"
      );
    } finally {
      setBusy(false);
    }
  }

  const form = useJobFormStore((s) => s.form);
  const setForm = useJobFormStore((s) => s.setForm);
  const resetForm = useJobFormStore((s) => s.resetForm);
  const loadForm = useJobFormStore((s) => s.loadForm);

  const assignTechIds = useAssignStore((s) => s.techIds);
  const assignDraft = useAssignStore((s) => s.draft);
  const assignQuery = useAssignStore((s) => s.query);
  const openAssignStore = useAssignStore((s) => s.openForJob);
  const setAssignDraft = useAssignStore((s) => s.setDraft);
  const applyAssignSearch = useAssignStore((s) => s.applySearch);
  const clearAssignSearch = useAssignStore((s) => s.clearSearch);
  const toggleAssignTech = useAssignStore((s) => s.toggleTech);
  const clearAssignTechs = useAssignStore((s) => s.clearTechs);
  const resetAssign = useAssignStore((s) => s.reset);

  const techDraft = useTechnicianBoardStore((s) => s.draft);
  const techQuery = useTechnicianBoardStore((s) => s.query);
  const setTechDraft = useTechnicianBoardStore((s) => s.setDraft);
  const applyTechSearch = useTechnicianBoardStore((s) => s.applySearch);
  const clearTechSearch = useTechnicianBoardStore((s) => s.clearSearch);

  const TECH_PAGE_SIZE = 5;
  const [techPage, setTechPage] = useState<Record<TechnicianStatus, number>>({
    available: 1,
    busy: 1,
    offline: 1,
  });
  const techStatusFilter = useDashboardFiltersStore((s) => s.techStatusFilter);
  const setTechStatusFilter = useDashboardFiltersStore((s) => s.setTechStatusFilter);
  const jobSectionFilter = useDashboardFiltersStore((s) => s.jobSectionFilter);
  const setJobSectionFilter = useDashboardFiltersStore((s) => s.setJobSectionFilter);
  const jobOwnershipMine = useDashboardFiltersStore((s) => s.jobOwnershipMine);
  const jobOwnershipDelegated = useDashboardFiltersStore(
    (s) => s.jobOwnershipDelegated
  );
  const setJobOwnershipMine = useDashboardFiltersStore(
    (s) => s.setJobOwnershipMine
  );
  const setJobOwnershipDelegated = useDashboardFiltersStore(
    (s) => s.setJobOwnershipDelegated
  );
  const jobPriorityFilter = useDashboardFiltersStore((s) => s.jobPriorityFilter);
  const setJobPriorityFilter = useDashboardFiltersStore(
    (s) => s.setJobPriorityFilter
  );
  const jobDeepLink = useJobDeepLink();

  useEffect(() => {
    if (!jobDeepLink.ready || !jobDeepLink.jobId || !jobDeepLink.section) return;
    setJobSectionFilter(jobDeepLink.section);
    setJobOwnershipMine(false);
    setJobOwnershipDelegated(false);
    setJobPriorityFilter("");
  }, [
    jobDeepLink.ready,
    jobDeepLink.jobId,
    jobDeepLink.section,
    setJobSectionFilter,
    setJobOwnershipMine,
    setJobOwnershipDelegated,
    setJobPriorityFilter,
  ]);

  const jobOwnershipFilter = useMemo(
    () =>
      userLevel === "teknisi"
        ? "all"
        : resolveJobOwnershipFilter(jobOwnershipMine, jobOwnershipDelegated),
    [userLevel, jobOwnershipMine, jobOwnershipDelegated]
  );

  const JOB_PAGE_SIZE = 5;
  const [activeJobPage, setActiveJobPage] = useState(1);
  const [queueJobPage, setQueueJobPage] = useState(1);
  const [completedJobPage, setCompletedJobPage] = useState(1);
  const [completedJobCursors, setCompletedJobCursors] = useState<
    (string | null)[]
  >([null]);
  const [cancelledJobPage, setCancelledJobPage] = useState(1);
  const [cancelledJobCursors, setCancelledJobCursors] = useState<
    (string | null)[]
  >([null]);

  const MASTER_PAGE_SIZE = 10;
  const [unitMasterPage, setUnitMasterPage] = useState(1);
  const [masterTechPage, setMasterTechPage] = useState(1);
  const [masterUserPage, setMasterUserPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendanceDraft, setAttendanceDraft] = useState("");
  const [attendanceQuery, setAttendanceQuery] = useState("");
  const [attendanceDateFilter, setAttendanceDateFilter] = useState("");
  const [attendanceSyncTech, setAttendanceSyncTech] = useState(true);
  const [attendanceImportMsg, setAttendanceImportMsg] = useState("");
  const [attendanceForm, setAttendanceForm] = useState({
    date: "",
    technician_id: "",
    technician_name: "",
    pernr: "",
    status: "hadir" as AttendanceStatus,
    dws: "",
    check_in: "",
    check_out: "",
    absence: "",
    note: "",
  });
  const [templatePreview, setTemplatePreview] = useState<JobTemplate | null>(
    null
  );
  /** Selected pending step ids per job — for parallel batch start. */
  const [selectedStepsByJob, setSelectedStepsByJob] = useState<
    Record<string, string[]>
  >({});
  const [stepTechnicianIds, setStepTechnicianIds] = useState<string[]>([]);
  const [stepNoteDraft, setStepNoteDraft] = useState("");
  const [stepNoteEditingId, setStepNoteEditingId] = useState("");
  const [stepPhotoDrafts, setStepPhotoDrafts] = useState<StepPhotoDraft[]>(
    []
  );
  const [stepPhotoRemoveIds, setStepPhotoRemoveIds] = useState<string[]>([]);
  const [stepNotePdfDraft, setStepNotePdfDraft] = useState<StepNotePdfDraft | null>(
    null
  );
  const [stepNotePdfRemove, setStepNotePdfRemove] = useState(false);
  /** sequential = auto one-by-one; parallel = checkbox batch start. */
  const [stepModeByJob, setStepModeByJob] = useState<
    Record<string, "sequential" | "parallel">
  >({});
  const [handoverDraftByJob, setHandoverDraftByJob] = useState<
    Record<
      string,
      {
        title: string;
        note: string;
        from_name: string;
        from_user_id: string;
        to_name: string;
        to_user_id: string;
      }
    >
  >({});
  /** Mode aksi handover per job: tampilkan UI sesuai pilihan. */
  const [handoverModeByJob, setHandoverModeByJob] = useState<
    Record<string, "tambah" | "ubah" | "hapus">
  >({});
  /** Saat kosong: form input baru muncul setelah klik + Tambah. */
  const [handoverComposeByJob, setHandoverComposeByJob] = useState<
    Record<string, boolean>
  >({});
  /** Local handover drafts per job — Save (mode ubah) writes to API. */
  const [handoverLocalByJob, setHandoverLocalByJob] = useState<
    Record<
      string,
      Array<{
        key: string;
        id?: string;
        title: string;
        to_name: string;
        to_user_id: string;
        from_name: string;
        from_user_id: string;
        note: string;
        done: boolean;
        order: number;
      }>
    >
  >({});

  type HandoverLocalRow = {
    key: string;
    id?: string;
    title: string;
    to_name: string;
    to_user_id: string;
    from_name: string;
    from_user_id: string;
    note: string;
    done: boolean;
    order: number;
  };

  function getHandoverMode(jobId: string): "tambah" | "ubah" | "hapus" {
    return handoverModeByJob[jobId] || "tambah";
  }

  function setHandoverMode(jobId: string, mode: "tambah" | "ubah" | "hapus") {
    setHandoverModeByJob((prev) => ({ ...prev, [jobId]: mode }));
    setHandoverLocalByJob((prev) => {
      if (!prev[jobId]) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    if (mode !== "tambah") {
      setHandoverDraftByJob((prev) => {
        if (!prev[jobId]) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }
  }

  const [partLoanDraftByJob, setPartLoanDraftByJob] = useState<
    Record<string, { part_name: string; note: string; status: PartLoanStatus }>
  >({});
  const [partLoanModeByJob, setPartLoanModeByJob] = useState<
    Record<string, "tambah" | "ubah" | "hapus">
  >({});
  const [partLoanComposeByJob, setPartLoanComposeByJob] = useState<
    Record<string, boolean>
  >({});
  const [partLoanLocalByJob, setPartLoanLocalByJob] = useState<
    Record<
      string,
      Array<{
        key: string;
        id?: string;
        part_name: string;
        note: string;
        status: PartLoanStatus;
        order: number;
      }>
    >
  >({});
  /** Loading state untuk tambah/simpan/hapus handover & part-loan. */
  const [notePanelBusy, setNotePanelBusy] = useState<{
    jobId: string;
    panel: "handover" | "part-loan";
    action: "add" | "save" | "delete";
  } | null>(null);

  function isNotePanelBusy(
    jobId: string,
    panel: "handover" | "part-loan",
    action?: "add" | "save" | "delete"
  ) {
    if (!notePanelBusy) return false;
    if (notePanelBusy.jobId !== jobId || notePanelBusy.panel !== panel) {
      return false;
    }
    return action ? notePanelBusy.action === action : true;
  }

  function notePanelBusyLabel(action: "add" | "save" | "delete") {
    if (action === "add") return "Menambah...";
    if (action === "save") return "Menyimpan...";
    return "Menghapus...";
  }

  type PartLoanLocalRow = {
    key: string;
    id?: string;
    part_name: string;
    note: string;
    status: PartLoanStatus;
    order: number;
  };

  function getPartLoanMode(jobId: string): "tambah" | "ubah" | "hapus" {
    return partLoanModeByJob[jobId] || "tambah";
  }

  function setPartLoanMode(jobId: string, mode: "tambah" | "ubah" | "hapus") {
    setPartLoanModeByJob((prev) => ({ ...prev, [jobId]: mode }));
    setPartLoanLocalByJob((prev) => {
      if (!prev[jobId]) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    if (mode !== "tambah") {
      setPartLoanDraftByJob((prev) => {
        if (!prev[jobId]) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }
  }

  function getStepMode(jobId: string): "sequential" | "parallel" {
    return stepModeByJob[jobId] || "sequential";
  }

  function setStepMode(jobId: string, mode: "sequential" | "parallel") {
    setStepModeByJob((prev) => ({ ...prev, [jobId]: mode }));
    if (mode === "sequential") {
      setSelectedStepsByJob((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }
  }

  const jobDraft = useJobBoardStore((s) => s.draft);
  const jobQuery = useJobBoardStore((s) => s.query);
  const setJobDraft = useJobBoardStore((s) => s.setDraft);
  const applyJobSearch = useJobBoardStore((s) => s.applySearch);
  const clearJobSearch = useJobBoardStore((s) => s.clearSearch);

  function openCreate() {
    if (!canJobCreate) return;
    resetForm();
    setTemplatePreview(null);
    setModal({ type: "create" });
  }

  function openEdit(job: JobWithDetails) {
    if (!canManageJob(job)) return;
    loadForm({
      title: job.title,
      priority: normalizeJobPriority(job.priority),
      unit_id: job.unit_id || "",
      description: job.description,
      estimated_minutes: String(job.estimated_minutes || 60),
      steps: job.steps.map((s) => s.name).join("\n"),
    });
    setModal({ type: "edit", job });
  }

  function openAssign(job: JobWithDetails) {
    if (!canAssignForJob(job)) return;
    const existing =
      job.technicians?.map((t) => t.id) ||
      (job.technician_id ? [job.technician_id] : []);
    openAssignStore(job.id, existing);
    setModal({ type: "assign", job });
  }

  async function openDelegate(job: JobWithDetails) {
    if (!canDelegateForJob(job)) return;
    setError("");
    setDelegateForemanId(job.delegated_to_user_id || "");
    setBusy(true);
    try {
      const list = await api<AppUserPublic[]>("/api/users/foremen");
      setForemanOptions(list.filter((u) => u.id !== userId));
      setModal({ type: "delegate-job", job });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat daftar foreman");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    resetAssign();
    setHandoverToQuery("");
    setHandoverToPage(1);
    setAssignPickerPage(1);
    setStepPhotoDrafts([]);
    setStepPhotoRemoveIds([]);
    setStepNoteDraft("");
    setStepNoteEditingId("");
    setStepNotePdfDraft(null);
    setStepNotePdfRemove(false);
    setModal(null);
  }

  function visibleStepPhotos(step: JobWithDetails["steps"][0]) {
    return (step.photos || []).filter(
      (p) => !stepPhotoRemoveIds.includes(p.id)
    );
  }

  function stepHasEvidence(step: JobWithDetails["steps"][0]) {
    return visibleStepPhotos(step).length + stepPhotoDrafts.length > 0;
  }

  function stepHasNoteText(step: JobWithDetails["steps"][0], draft = "") {
    return Boolean(draft.trim() || stepHasNote(step));
  }

  function notesForStepDisplay(
    step: JobWithDetails["steps"][0],
    jobId = ""
  ) {
    return (
      attachStepNotes({
        ...step,
        job_id: String(step.job_id || jobId || ""),
      }).notes || []
    );
  }

  function renderStepNoteThread(
    step: JobWithDetails["steps"][0],
    opts?: { allowEdit?: boolean; job?: JobWithDetails }
  ) {
    const notes = notesForStepDisplay(step, opts?.job?.id);
    if (!notes.length) {
      return (
        <span className="step-note-body">—</span>
      );
    }
    const canEdit =
      Boolean(opts?.allowEdit && opts.job && canNotesDeleteForJob(opts.job));
    return notes.map((n) => {
      const when = formatStepNoteAt(n.created_at);
      const who = String(n.user_name || "").trim();
      const edited = n.edited_at
        ? n.edited_by_name
          ? ` (${t("job.stepNoteEditedBy", { name: n.edited_by_name })})`
          : ` (${t("job.stepNoteEdited")})`
        : "";
      return (
        <span
          className={`step-note-entry${
            stepNoteEditingId === n.id ? " is-editing" : ""
          }`}
          key={n.id}
        >
          <span className="step-note-entry-head">
            <span className="step-note-byline">
              {when ? (
                <>
                  <MetaIcon>📅</MetaIcon>
                  {when}
                </>
              ) : null}
              {when && (who || edited) ? (
                <span className="step-note-byline-sep">|</span>
              ) : null}
              {who ? (
                <>
                  <MetaIcon>👷</MetaIcon>
                  <span className="step-note-byline-name">
                    {who}
                    {edited}
                  </span>
                </>
              ) : (
                edited.trim()
              )}
              {!when && !who && !edited ? t("job.stepNote") : null}
            </span>
            {canEdit ? (
              <button
                type="button"
                className="step-note-edit-btn"
                disabled={busy}
                onClick={() => {
                  setStepNoteEditingId(n.id);
                  setStepNoteDraft(n.body);
                  setStepNotePdfDraft(null);
                  setStepNotePdfRemove(false);
                }}
              >
                {t("job.stepNoteChange")}
              </button>
            ) : null}
          </span>
          <span className="step-note-body">{n.body}</span>
          {n.file_url || n.file_original_name ? (
            n.file_url ? (
              <a
                className="step-note-pdf-link"
                href={n.file_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {n.file_original_name || "lampiran.pdf"}
              </a>
            ) : (
              <span className="step-note-pdf-link">
                {n.file_original_name || "lampiran.pdf"}
              </span>
            )
          ) : null}
        </span>
      );
    });
  }

  function stepPhotoActionPayload() {
    return {
      photos: stepPhotoDrafts.map((d) => ({
        photo_base64: d.base64,
        thumb_base64: d.thumb_base64,
        photo_mime: d.mime,
        photo_name: d.name,
      })),
      remove_photo_ids: stepPhotoRemoveIds,
    };
  }

  function currentHandoverFrom() {
    return {
      from_name: (session?.user?.name || displayName || "").trim(),
      from_user_id: userId,
    };
  }

  function emptyHandoverDraft() {
    return {
      title: "",
      note: "",
      to_name: "",
      to_user_id: "",
      ...currentHandoverFrom(),
    };
  }

  async function openHandoverToPicker(
    job: JobWithDetails,
    target: "draft" | { key: string },
    current: string,
    currentUserId = ""
  ) {
    setError("");
    setHandoverToQuery("");
    setHandoverToPage(1);
    setHandoverToLoading(true);
    setModal({
      type: "handover-to",
      job,
      target,
      current,
      currentUserId,
    });
    try {
      const list = await api<AppUserPublic[]>("/api/users/handover-recipients");
      const assignedUserIds = new Set(
        (job.technicians || [])
          .map((t) => String(t.user_id || "").trim())
          .filter(Boolean)
      );
      const rank = (u: AppUserPublic) => {
        if (u.level === "teknisi" && assignedUserIds.has(u.id)) return 0;
        if (u.level === "teknisi") return 1;
        return 2;
      };
      setHandoverRecipientOptions(
        [...list].sort((a, b) => {
          const byRank = rank(a) - rank(b);
          if (byRank !== 0) return byRank;
          return userDisplayName(a).localeCompare(userDisplayName(b), "id");
        })
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gagal memuat daftar penerima"
      );
      setHandoverRecipientOptions([]);
    } finally {
      setHandoverToLoading(false);
    }
  }

  function applyHandoverTo(user: AppUserPublic | null) {
    if (modal?.type !== "handover-to") return;
    const { job, target } = modal;
    const nextName = user ? userDisplayName(user) : "";
    const nextId = user ? user.id : "";
    if (target === "draft") {
      setHandoverDraftByJob((prev) => ({
        ...prev,
        [job.id]: {
          ...getHandoverDraft(job),
          to_name: nextName,
          to_user_id: nextId,
        },
      }));
    } else {
      setHandoverLocal(job, (rows) =>
        rows.map((r) =>
          r.key === target.key
            ? { ...r, to_name: nextName, to_user_id: nextId }
            : r
        )
      );
    }
    closeModal();
  }

  function renderHandoverFromField(value: string) {
    return (
      <input
        className="handover-input"
        value={value}
        disabled
        readOnly
        tabIndex={-1}
        aria-label={t("job.handoverFrom")}
        placeholder={t("job.handoverFromPlaceholder")}
      />
    );
  }

  function renderHandoverToTrigger(
    job: JobWithDetails,
    value: string,
    target: "draft" | { key: string },
    userId = ""
  ) {
    return (
      <button
        type="button"
        className="handover-to-trigger"
        disabled={busy}
        onClick={() => void openHandoverToPicker(job, target, value, userId)}
        aria-haspopup="dialog"
        aria-label={t("job.handoverTo")}
      >
        <span
          className={`handover-to-trigger-label${value ? "" : " is-placeholder"}`}
        >
          {value || t("job.handoverToPlaceholder")}
        </span>
        <span className="handover-to-caret" aria-hidden>
          ▾
        </span>
      </button>
    );
  }

  function parseSteps(text: string): string[] {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const canEditJobSteps =
    modal?.type === "create" ||
    (modal?.type === "edit" &&
      ["queued", "assigned"].includes(modal.job.status));

  const isTemplateCreate =
    modal?.type === "create" && form.mode === "template";

  const jobFormValid =
    form.title.trim().length > 0 &&
    form.unit_id.trim().length > 0 &&
    form.description.trim().length > 0 &&
    Number(form.estimated_minutes) > 0 &&
    (isTemplateCreate
      ? Boolean(form.template_id)
      : !canEditJobSteps || parseSteps(form.steps).length > 0);

  async function applyJobTemplate(templateId: string) {
    if (!templateId) {
      setTemplatePreview(null);
      setForm({
        template_id: "",
        steps: "",
        estimated_minutes: "90",
      });
      return;
    }
    try {
      const tpl = await fetchTemplate(templateId);
      setTemplatePreview(tpl);
      const stepLines = tpl.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => (s.phase ? `${s.phase}: ${s.name}` : s.name));
      setForm({
        template_id: tpl.id,
        title: `Recondition ${tpl.name}`,
        estimated_minutes: String(tpl.std_minutes || 60),
        steps: stepLines.join("\n"),
        description: `Job recondition ${tpl.name} (time frame standar).`,
      });
    } catch (e) {
      setTemplatePreview(null);
      setError(e instanceof Error ? e.message : "Gagal load detail template");
    }
  }

  function formatStdLabel(minutes: number): string {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    const hours = t("common.hours");
    const mins = t("common.minutes");
    if (rem === 0) return `${h} ${hours}`;
    if (h <= 0) return `${rem} ${mins}`;
    return `${h} ${hours} ${rem} ${mins}`;
  }

  function openExportJobsModal() {
    if (!isLoggedIn) {
      setError("Silakan login untuk export laporan job");
      return;
    }
    setExportForm({
      scope: "active",
      dateField: "created",
      dateFrom: "",
      dateTo: "",
    });
    setModal({ type: "export-jobs" });
  }

  function openJobBackupsModal() {
    if (userLevel !== "superuser") {
      setError("Backup / Undo hanya untuk superuser");
      return;
    }
    setError("");
    setJobBackupsIncludeUndone(false);
    setModal({ type: "job-backups" });
  }

  async function undoJobBackup(id: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/backups/jobs", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await Promise.all([invalidateBackups(), invalidateDashboard()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal undo");
    } finally {
      setBusy(false);
    }
  }

  function requestExportJobsReport() {
    if (!isLoggedIn) {
      setError("Silakan login untuk export laporan job");
      return;
    }
    if (
      exportForm.dateFrom &&
      exportForm.dateTo &&
      exportForm.dateFrom > exportForm.dateTo
    ) {
      setError("Tanggal dari tidak boleh lebih besar dari tanggal sampai");
      return;
    }
    setError("");
    setModal({ type: "export-jobs-confirm" });
  }

  async function exportJobsReport() {
    const scope = exportForm.scope;
    const title =
      scope === "active"
        ? t("export.busyLabel")
        : t("export.busyLabelQueue");
    setModal({
      type: "process-alert",
      title,
      message:
        scope === "active"
          ? "Sedang mengekspor job aktif ke Excel..."
          : "Sedang mengekspor job antrian ke Excel...",
      phase: "loading",
    });
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        scope,
        dateField: exportForm.dateField,
      });
      if (exportForm.dateFrom) params.set("from", exportForm.dateFrom);
      if (exportForm.dateTo) params.set("to", exportForm.dateTo);

      const res = await fetch(`/api/reports/jobs?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `Gagal export (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const matched = disposition.match(/filename="([^"]+)"/i);
      const filename =
        matched?.[1] ||
        (scope === "active"
          ? "report-job-aktif.xlsx"
          : "report-job-antrian.xlsx");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setModal({
        type: "process-alert",
        title,
        message: `Export berhasil.\nFile: ${filename}`,
        phase: "success",
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Gagal export laporan job";
      setError(message);
      setModal({
        type: "process-alert",
        title,
        message,
        phase: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function printJobPdf(job: JobWithDetails) {
    setModal({
      type: "process-alert",
      title: "Print PDF",
      message: `Sedang menyiapkan PDF untuk:\n${job.title}`,
      phase: "loading",
    });
    setBusy(true);
    setError("");
    try {
      await new Promise((r) => setTimeout(r, 80));
      await downloadJobPdf(job);
      setModal({
        type: "process-alert",
        title: "Print PDF",
        message: `PDF berhasil dibuat untuk:\n${job.title}`,
        phase: "success",
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Gagal membuat PDF job";
      setError(message);
      setModal({
        type: "process-alert",
        title: "Print PDF",
        message,
        phase: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as "light" | "dark") ||
      "dark";
    setTheme(current);
    setHideTechPanel(readBoolFlag(HIDE_TECH_PANEL_KEY));
    setHideJobPanel(readBoolFlag(HIDE_JOB_PANEL_KEY));
  }, []);

  function toggleHideTechPanel() {
    setHideTechPanel((prev) => {
      const next = !prev;
      writeBoolFlag(HIDE_TECH_PANEL_KEY, next);
      return next;
    });
  }

  function toggleHideJobPanel() {
    setHideJobPanel((prev) => {
      const next = !prev;
      writeBoolFlag(HIDE_JOB_PANEL_KEY, next);
      return next;
    });
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("tus-theme", next);
    } catch {
      /* ignore */
    }
  }

  function handleAuthClick() {
    if (!isLoggedIn) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(next)}`;
      return;
    }
    openLogoutConfirm();
  }

  function openLogoutConfirm() {
    setError("");
    setSessionOpen(false);
    setMobileMenuOpen(false);
    setModal({ type: "logout" });
  }

  function openChangePassword() {
    setError("");
    setPasswordChangeMsg("");
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setModal({ type: "change-password" });
  }

  async function openEditProfile() {
    setError("");
    setProfileChangeMsg("");
    setProfileForm({ name: "", email: "", phone: "" });
    setProfilePhotoUrl("");
    setProfilePhotoDraft(null);
    setProfilePhotoRemoved(false);
    setModal({ type: "edit-profile" });
    setBusy(true);
    try {
      const me = await api<AppUserPublic>("/api/account/profile");
      setProfileForm({
        name: me.name || "",
        email: me.email || "",
        phone: me.phone || "",
      });
      setProfilePhotoUrl(me.photo_url || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("profile.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function saveOwnProfile() {
    if (modal?.type !== "edit-profile") return;
    setBusy(true);
    setError("");
    setProfileChangeMsg("");
    try {
      const saved = await api<AppUserPublic>("/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          ...profileForm,
          photo_base64: profilePhotoDraft?.base64,
          photo_mime: profilePhotoDraft?.mime,
          remove_photo: profilePhotoRemoved && !profilePhotoDraft,
        }),
      });
      setProfileForm({
        name: saved.name || "",
        email: saved.email || "",
        phone: saved.phone || "",
      });
      setProfilePhotoUrl(saved.photo_url || "");
      setProfilePhotoDraft(null);
      setProfilePhotoRemoved(false);
      setAvatarUrl(saved.photo_url || "");
      await updateSession({ name: saved.name || saved.username });
      setProfileChangeMsg(t("profile.success"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("profile.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function onPickProfilePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const draft = await compressAvatarFile(file);
      setProfilePhotoDraft(draft);
      setProfilePhotoRemoved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("profile.saveError"));
    } finally {
      setBusy(false);
      if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = "";
    }
  }

  async function saveOwnPassword() {
    if (modal?.type !== "change-password") return;
    setBusy(true);
    setError("");
    setPasswordChangeMsg("");
    try {
      await api<{ ok: true }>("/api/account/password", {
        method: "POST",
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordChangeMsg("Password berhasil diperbarui.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah password");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setBusy(true);
    writeCachedSession(null);
    try {
      await signOut({ callbackUrl: "/sign-in" });
    } catch {
      window.location.href = "/sign-in";
    } finally {
      // Keep overlay if redirect is slow; reset if still on page
      setBusy(false);
      setLoggingOut(false);
    }
  }

  const assignPoolQuery = useAssignTechnicianPool(
    assignQuery,
    isLoggedIn &&
      (canJobAssign ||
        modal?.type === "assign" ||
        modal?.type === "confirm-assign")
  );
  const availableTechs = useMemo(
    () => assignPoolQuery.data?.items || [],
    [assignPoolQuery.data]
  );

  const assignTechLookup = useMemo(() => {
    const map = new Map<string, Technician>();
    for (const t of assignPoolQuery.data?.items || []) map.set(t.id, t);
    if (modal?.type === "assign" || modal?.type === "confirm-assign") {
      for (const t of modal.job.technicians || []) {
        if (!map.has(t.id)) map.set(t.id, t);
      }
    }
    return map;
  }, [assignPoolQuery.data, modal]);

  const assignSelectableTechs = useMemo(() => {
    const q = assignQuery.trim().toLowerCase();
    const jobId =
      modal?.type === "assign" || modal?.type === "confirm-assign"
        ? modal.job.id
        : null;
    const checkedOrder = new Map(assignTechIds.map((id, i) => [id, i]));
    const rank = (t: Technician) => {
      if (checkedOrder.has(t.id)) return 0;
      if (userId && t.superior_user_id === userId) return 1;
      return 2;
    };
    return [...assignTechLookup.values()]
      .filter(
        (t) =>
          (t.status === "available" ||
            t.current_job_id === jobId ||
            assignTechIds.includes(t.id)) &&
          (!q ||
            t.name.toLowerCase().includes(q) ||
            t.sn.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
          return (checkedOrder.get(a.id) ?? 0) - (checkedOrder.get(b.id) ?? 0);
        }
        return a.name.localeCompare(b.name, "id");
      });
  }, [assignTechLookup, assignQuery, assignTechIds, modal, userId]);

  useEffect(() => {
    setAssignPickerPage(1);
  }, [assignQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(assignSelectableTechs.length / TECH_PAGE_SIZE)
    );
    setAssignPickerPage((p) => (p > totalPages ? totalPages : p));
  }, [assignSelectableTechs.length, TECH_PAGE_SIZE]);

  const assignPickerTotalPages = Math.max(
    1,
    Math.ceil(assignSelectableTechs.length / TECH_PAGE_SIZE)
  );
  const assignPickerPageSafe = Math.min(
    assignPickerPage,
    assignPickerTotalPages
  );
  const pagedAssignTechs = assignSelectableTechs.slice(
    (assignPickerPageSafe - 1) * TECH_PAGE_SIZE,
    assignPickerPageSafe * TECH_PAGE_SIZE
  );

  const attendanceTechListQuery = useTechniciansList({
    status: "all",
    page: 1,
    limit: 500,
    enabled:
      modal?.type === "attendance" || modal?.type === "attendance-form",
  });
  const attendanceTechnicians = attendanceTechListQuery.data?.items || [];

  const masterTechListQuery = useTechniciansList({
    status: "all",
    page: masterTechPage,
    limit: MASTER_PAGE_SIZE,
    q: masterTechQuery,
    enabled: modal?.type === "techs",
  });
  const pagedMasterTechs = masterTechListQuery.data?.items || [];
  const masterTechTotal = masterTechListQuery.data?.total ?? 0;
  const masterTechTotalPages = masterTechListQuery.data?.totalPages ?? 1;
  const masterTechPageSafe = Math.min(masterTechPage, masterTechTotalPages);

  useEffect(() => {
    if (modal?.type !== "units") {
      setUnitDraft("");
      setUnitQuery("");
      setUnitMasterPage(1);
    }
    if (modal?.type !== "templates") {
      setTemplateDraft("");
      setTemplateQuery("");
      setTemplateCategoryFilter("");
      setTemplateMasterPage(1);
      setTemplateCloneId("");
      setTemplateImportMsg("");
    }
    if (modal?.type !== "techs") {
      setMasterTechDraft("");
      setMasterTechQuery("");
      setMasterTechPage(1);
    }
    if (modal?.type !== "attendance") {
      setAttendanceDraft("");
      setAttendanceQuery("");
      setAttendancePage(1);
      setAttendanceImportMsg("");
    }
  }, [modal?.type]);

  const filteredUnits = useMemo(() => {
    const units = data?.units || [];
    const q = unitQuery.trim().toLowerCase();
    if (!q) return units;
    return units.filter(
      (u) =>
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.serial_number || "").toLowerCase().includes(q)
    );
  }, [data?.units, unitQuery]);

  useEffect(() => {
    setUnitMasterPage(1);
  }, [unitQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredUnits.length / MASTER_PAGE_SIZE)
    );
    setUnitMasterPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredUnits.length]);

  const unitMasterTotalPages = Math.max(
    1,
    Math.ceil(filteredUnits.length / MASTER_PAGE_SIZE)
  );
  const unitMasterPageSafe = Math.min(unitMasterPage, unitMasterTotalPages);
  const pagedUnits = filteredUnits.slice(
    (unitMasterPageSafe - 1) * MASTER_PAGE_SIZE,
    unitMasterPageSafe * MASTER_PAGE_SIZE
  );

  function applyUnitSearch() {
    setUnitQuery(unitDraft.trim());
  }

  function clearUnitSearch() {
    setUnitDraft("");
    setUnitQuery("");
  }

  const handoverToFiltered = useMemo(() => {
    const q = handoverToQuery.trim().toLowerCase();
    if (!q) return handoverRecipientOptions;
    return handoverRecipientOptions.filter((u) =>
      [u.name, u.username, u.email, u.phone, u.level]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [handoverRecipientOptions, handoverToQuery]);

  useEffect(() => {
    setHandoverToPage(1);
  }, [handoverToQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(handoverToFiltered.length / TECH_PAGE_SIZE)
    );
    setHandoverToPage((p) => (p > totalPages ? totalPages : p));
  }, [handoverToFiltered.length, TECH_PAGE_SIZE]);

  const handoverToTotalPages = Math.max(
    1,
    Math.ceil(handoverToFiltered.length / TECH_PAGE_SIZE)
  );
  const handoverToPageSafe = Math.min(handoverToPage, handoverToTotalPages);
  const pagedHandoverTo = handoverToFiltered.slice(
    (handoverToPageSafe - 1) * TECH_PAGE_SIZE,
    handoverToPageSafe * TECH_PAGE_SIZE
  );

  const filteredMasterTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return masterTemplates.filter((tpl) => {
      if (templateCategoryFilter && tpl.category !== templateCategoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        tpl.name.toLowerCase().includes(q) ||
        tpl.id.toLowerCase().includes(q) ||
        tpl.category.toLowerCase().includes(q)
      );
    });
  }, [masterTemplates, templateQuery, templateCategoryFilter]);

  useEffect(() => {
    setTemplateMasterPage(1);
  }, [templateQuery, templateCategoryFilter]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredMasterTemplates.length / MASTER_PAGE_SIZE)
    );
    setTemplateMasterPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredMasterTemplates.length]);

  const templateMasterTotalPages = Math.max(
    1,
    Math.ceil(filteredMasterTemplates.length / MASTER_PAGE_SIZE)
  );
  const templateMasterPageSafe = Math.min(
    templateMasterPage,
    templateMasterTotalPages
  );
  const pagedMasterTemplates = filteredMasterTemplates.slice(
    (templateMasterPageSafe - 1) * MASTER_PAGE_SIZE,
    templateMasterPageSafe * MASTER_PAGE_SIZE
  );

  const templateFormStdMinutes = useMemo(
    () =>
      templateForm.steps.reduce(
        (sum, s) => sum + Math.max(0, Number(s.std_minutes) || 0),
        0
      ),
    [templateForm.steps]
  );

  function applyTemplateSearch() {
    setTemplateQuery(templateDraft.trim());
  }

  function clearTemplateSearch() {
    setTemplateDraft("");
    setTemplateQuery("");
  }

  function applyMasterTechSearch() {
    setMasterTechQuery(masterTechDraft.trim());
    setMasterTechPage(1);
  }

  function clearMasterTechSearch() {
    setMasterTechDraft("");
    setMasterTechQuery("");
  }

  useEffect(() => {
    setMasterTechPage(1);
  }, [masterTechQuery]);

  const filteredMasterUsers = useMemo(() => {
    const q = masterUserQuery.trim().toLowerCase();
    if (!q) return appUsers;
    return appUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.phone || "").toLowerCase().includes(q)
    );
  }, [appUsers, masterUserQuery]);

  useEffect(() => {
    setMasterUserPage(1);
  }, [masterUserQuery]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredMasterUsers.length / MASTER_PAGE_SIZE)
    );
    setMasterUserPage((p) => (p > totalPages ? totalPages : p));
  }, [filteredMasterUsers.length]);

  const masterUserTotalPages = Math.max(
    1,
    Math.ceil(filteredMasterUsers.length / MASTER_PAGE_SIZE)
  );
  const masterUserPageSafe = Math.min(masterUserPage, masterUserTotalPages);
  const pagedMasterUsers = filteredMasterUsers.slice(
    (masterUserPageSafe - 1) * MASTER_PAGE_SIZE,
    masterUserPageSafe * MASTER_PAGE_SIZE
  );

  function applyMasterUserSearch() {
    setMasterUserQuery(masterUserDraft.trim());
  }

  function clearMasterUserSearch() {
    setMasterUserDraft("");
    setMasterUserQuery("");
  }

  const userFormValid =
    userForm.username.trim().length > 0 &&
    (modal?.type === "user-form" && modal.mode === "edit"
      ? true
      : userForm.password.length > 0);

  const filteredAttendance = useMemo(() => {
    let rows = data?.attendance || [];
    if (attendanceDateFilter) {
      rows = rows.filter((a) => a.date === attendanceDateFilter);
    }
    const q = attendanceQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.technician_name.toLowerCase().includes(q) ||
        a.pernr.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q) ||
        a.absence.toLowerCase().includes(q)
    );
  }, [data?.attendance, attendanceDateFilter, attendanceQuery]);

  useEffect(() => {
    setAttendancePage(1);
  }, [attendanceQuery, attendanceDateFilter]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredAttendance.length / MASTER_PAGE_SIZE)
    );
    setAttendancePage((p) => (p > totalPages ? totalPages : p));
  }, [filteredAttendance.length]);

  const attendanceTotalPages = Math.max(
    1,
    Math.ceil(filteredAttendance.length / MASTER_PAGE_SIZE)
  );
  const attendancePageSafe = Math.min(attendancePage, attendanceTotalPages);
  const pagedAttendance = filteredAttendance.slice(
    (attendancePageSafe - 1) * MASTER_PAGE_SIZE,
    attendancePageSafe * MASTER_PAGE_SIZE
  );

  function applyAttendanceSearch() {
    setAttendanceQuery(attendanceDraft.trim());
  }

  function clearAttendanceSearch() {
    setAttendanceDraft("");
    setAttendanceQuery("");
  }

  const attendanceDates = useMemo(() => {
    const set = new Set((data?.attendance || []).map((a) => a.date));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [data?.attendance]);

  const techFormValid =
    techForm.name.trim().length > 0 &&
    techForm.sn.trim().length > 0 &&
    techForm.badge_id.trim().length > 0 &&
    techForm.email.trim().length > 0 &&
    techForm.phone.trim().length > 0;

  const techAvailableQuery = useTechniciansList({
    status: "available",
    page: techPage.available,
    limit: TECH_PAGE_SIZE,
    q: techQuery,
    enabled: techStatusFilter === "all" || techStatusFilter === "available",
  });
  const techBusyQuery = useTechniciansList({
    status: "busy",
    page: techPage.busy,
    limit: TECH_PAGE_SIZE,
    q: techQuery,
    enabled: techStatusFilter === "all" || techStatusFilter === "busy",
  });
  const techOfflineQuery = useTechniciansList({
    status: "offline",
    page: techPage.offline,
    limit: TECH_PAGE_SIZE,
    q: techQuery,
    enabled: techStatusFilter === "all" || techStatusFilter === "offline",
  });

  const techQueries: Record<
    TechnicianStatus,
    ReturnType<typeof useTechniciansList>
  > = {
    available: techAvailableQuery,
    busy: techBusyQuery,
    offline: techOfflineQuery,
  };

  useEffect(() => {
    setTechPage({ available: 1, busy: 1, offline: 1 });
  }, [techQuery, techStatusFilter]);

  const jobListHasFilter =
    Boolean(jobQuery) ||
    Boolean(jobDeepLink.jobId) ||
    jobOwnershipFilter !== "all";
  const jobListHasPriorityFilter = Boolean(jobPriorityFilter);
  const liveJobListHasFilter = jobListHasFilter || jobListHasPriorityFilter;

  const showActiveJobs =
    jobSectionFilter === "all" || jobSectionFilter === "active";
  const showQueueJobs =
    jobSectionFilter === "all" || jobSectionFilter === "queue";
  const showDoneJobs =
    jobSectionFilter === "all" || jobSectionFilter === "done";
  const showCancelledJobs =
    jobSectionFilter === "all" || jobSectionFilter === "cancelled";

  const activeJobsQuery = useJobsList({
    section: "active",
    page: activeJobPage,
    limit: JOB_PAGE_SIZE,
    q: jobQuery,
    ownership: jobOwnershipFilter,
    priority: jobPriorityFilter,
    jobId: jobDeepLink.jobId,
    enabled: showActiveJobs,
  });
  const queueJobsQuery = useJobsList({
    section: "queue",
    page: queueJobPage,
    limit: JOB_PAGE_SIZE,
    q: jobQuery,
    ownership: jobOwnershipFilter,
    priority: jobPriorityFilter,
    jobId: jobDeepLink.jobId,
    enabled: showQueueJobs,
  });
  const completedJobsQuery = useJobsList({
    section: "done",
    page: completedJobPage,
    limit: JOB_PAGE_SIZE,
    q: jobQuery,
    ownership: jobOwnershipFilter,
    jobId: jobDeepLink.jobId,
    enabled: showDoneJobs,
    cursor: completedJobCursors[completedJobPage - 1] ?? null,
  });
  const cancelledJobsQuery = useJobsList({
    section: "cancelled",
    page: cancelledJobPage,
    limit: JOB_PAGE_SIZE,
    q: jobQuery,
    ownership: jobOwnershipFilter,
    jobId: jobDeepLink.jobId,
    enabled: showCancelledJobs,
    cursor: cancelledJobCursors[cancelledJobPage - 1] ?? null,
  });
  const sliderJobsQuery = useActiveJobsSlider({
    q: jobQuery,
    ownership: jobOwnershipFilter,
    priority: jobPriorityFilter,
    jobId: jobDeepLink.jobId,
    enabled: isLoggedIn,
  });

  const activeJobs = activeJobsQuery.data?.items || [];
  const queuedJobs = queueJobsQuery.data?.items || [];
  const completedJobs = completedJobsQuery.data?.items || [];
  const historyJobs = cancelledJobsQuery.data?.items || [];
  const sliderJobs = sliderJobsQuery.data?.items || activeJobs;

  const activeJobTotalPages = activeJobsQuery.data?.totalPages ?? 1;
  const activeJobPageSafe = Math.min(activeJobPage, activeJobTotalPages);
  const queueJobTotalPages = queueJobsQuery.data?.totalPages ?? 1;
  const queueJobPageSafe = Math.min(queueJobPage, queueJobTotalPages);
  const completedJobTotalPages = completedJobsQuery.data?.totalPages ?? 1;
  const completedJobTotal = completedJobsQuery.data?.total ?? 0;
  const completedJobHasNext = Boolean(completedJobsQuery.data?.nextCursor);
  const cancelledJobTotalPages = cancelledJobsQuery.data?.totalPages ?? 1;
  const cancelledJobTotal = cancelledJobsQuery.data?.total ?? 0;
  const cancelledJobHasNext = Boolean(cancelledJobsQuery.data?.nextCursor);

  const jobMap = useMemo(() => {
    const merged = [
      ...activeJobs,
      ...queuedJobs,
      ...sliderJobs,
      ...completedJobs,
      ...historyJobs,
    ];
    return Object.fromEntries(merged.map((j) => [j.id, j]));
  }, [activeJobs, queuedJobs, sliderJobs, completedJobs, historyJobs]);

  useEffect(() => {
    const jobId = jobDeepLink.jobId;
    if (!jobId) {
      clearDeepLinkScroll();
      return;
    }
    if (!jobDeepLink.ready) return;
    const key = deepLinkScrollKey(jobId, jobDeepLink.focus);
    if (peekDeepLinkScrollKey() === key) return;

    let cancelled = false;
    let attempts = 0;
    const visible = (id: string) => {
      const nodes = document.querySelectorAll(`#${CSS.escape(id)}`);
      return (
        [...nodes].find((node) => {
          const html = node as HTMLElement;
          return html.offsetParent !== null || html.getClientRects().length > 0;
        }) || (nodes[0] as HTMLElement | undefined)
      );
    };
    const findEl = () => {
      if (jobDeepLink.focus === "handover") {
        return visible(`job-handover-${jobId}`) || visible(`job-${jobId}`);
      }
      return visible(`job-${jobId}`);
    };
    const tryScroll = () => {
      if (cancelled || peekDeepLinkScrollKey() === key) return;
      const el = findEl();
      if (el) {
        markDeepLinkScrolled(key);
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 40) window.setTimeout(tryScroll, 50);
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [
    jobDeepLink.jobId,
    jobDeepLink.ready,
    jobDeepLink.focus,
    jobDeepLink.scrollGen,
  ]);

  useEffect(() => {
    setActiveJobPage(1);
    setQueueJobPage(1);
    setCompletedJobPage(1);
    setCompletedJobCursors([null]);
    setCancelledJobPage(1);
    setCancelledJobCursors([null]);
  }, [jobQuery, jobSectionFilter, jobOwnershipMine, jobOwnershipDelegated, jobPriorityFilter, jobDeepLink.jobId]);

  function goCompletedArchiveNext() {
    const next = completedJobsQuery.data?.nextCursor;
    if (!next) return;
    setCompletedJobCursors((c) => [...c, next]);
    setCompletedJobPage((p) => p + 1);
  }

  function goCompletedArchivePrev() {
    if (completedJobPage <= 1) return;
    setCompletedJobCursors((c) => c.slice(0, -1));
    setCompletedJobPage((p) => p - 1);
  }

  function goCancelledArchiveNext() {
    const next = cancelledJobsQuery.data?.nextCursor;
    if (!next) return;
    setCancelledJobCursors((c) => [...c, next]);
    setCancelledJobPage((p) => p + 1);
  }

  function goCancelledArchivePrev() {
    if (cancelledJobPage <= 1) return;
    setCancelledJobCursors((c) => c.slice(0, -1));
    setCancelledJobPage((p) => p - 1);
  }

  async function runAction(
    jobId: string,
    action: string,
    payload?: Record<string, unknown>
  ) {
    setBusy(true);
    setError("");
    try {
      await jobActionMutation.mutateAsync({ jobId, action, payload });
      if (action === "start_steps" || action === "start_step") {
        setSelectedStepsByJob((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }
      closeModal();
      if (action === "assign") {
        clearJobSearch();
        setJobSectionFilter("active");
        setJobOwnershipMine(false);
        setJobOwnershipDelegated(false);
        setJobPriorityFilter("");
        jobDeepLink.open(jobId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aksi gagal");
    } finally {
      setBusy(false);
    }
  }

  function initStepTechnicianIds(
    job: JobWithDetails,
    step: JobWithDetails["steps"][0]
  ) {
    setStepTechnicianIds(
      displayStepTechnicianIds(step, assignedTechnicianIds(job))
    );
  }

  function toggleStepTechnician(id: string) {
    setStepTechnicianIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function renderStepTechnicianPicker(
    job: JobWithDetails,
    opts?: { locked?: boolean }
  ) {
    const assigned = new Set(assignedTechnicianIds(job));
    const byId = new Map<string, (typeof job.technicians)[number]>();
    for (const t of job.technician_index || []) {
      if (t?.id) byId.set(t.id, t);
    }
    for (const t of job.technicians || []) {
      if (t?.id) byId.set(t.id, t);
    }
    const techs = [...byId.values()].filter(
      (t) => assigned.has(t.id) || stepTechnicianIds.includes(t.id)
    );
    if (!techs.length) return null;
    return (
      <div className="check-list" style={{ margin: "0 0 16px" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 8px" }}>
          {t("job.stepTechniciansHint")}
        </p>
        {techs.map((tech) => (
          <label className="check-item" key={tech.id}>
            <input
              type="checkbox"
              checked={stepTechnicianIds.includes(tech.id)}
              disabled={busy || Boolean(opts?.locked)}
              onChange={() => toggleStepTechnician(tech.id)}
            />
            <span>
              {tech.name}
              {tech.sn ? (
                <span style={{ color: "var(--muted)" }}> — {tech.sn}</span>
              ) : null}
              {!assigned.has(tech.id) ? (
                <span style={{ color: "var(--muted)" }}> · sebelumnya</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    );
  }

  function toggleStepSelect(jobId: string, stepId: string, checked: boolean) {
    setSelectedStepsByJob((prev) => {
      const cur = new Set(prev[jobId] || []);
      if (checked) cur.add(stepId);
      else cur.delete(stepId);
      return { ...prev, [jobId]: Array.from(cur) };
    });
  }

  function getHandoverDraft(job: JobWithDetails) {
    const d = handoverDraftByJob[job.id];
    const fallback = currentHandoverFrom();
    return {
      title: d?.title || "",
      note: d?.note || "",
      from_name: d ? d.from_name : fallback.from_name,
      from_user_id: d ? d.from_user_id : fallback.from_user_id,
      to_name: d?.to_name || "",
      to_user_id: d?.to_user_id || "",
    };
  }

  function handoversFromServer(job: JobWithDetails): HandoverLocalRow[] {
    return (job.handovers || []).map((h) => ({
      key: h.id,
      id: h.id,
      title: h.title,
      from_name: h.from_name || h.user_name || "",
      from_user_id: h.from_user_id || h.user_id || "",
      to_name: h.to_name || "",
      to_user_id: h.to_user_id || "",
      note: h.note,
      done: h.done === "1",
      order: h.order,
    }));
  }

  function getHandoverLocal(job: JobWithDetails): HandoverLocalRow[] {
    return handoverLocalByJob[job.id] || handoversFromServer(job);
  }

  function setHandoverLocal(
    job: JobWithDetails,
    updater: (rows: HandoverLocalRow[]) => HandoverLocalRow[]
  ) {
    setHandoverLocalByJob((prev) => ({
      ...prev,
      [job.id]: updater(prev[job.id] || handoversFromServer(job)),
    }));
  }

  function isHandoverDirty(job: JobWithDetails): boolean {
    const local = handoverLocalByJob[job.id];
    if (!local) return false;
    const server = handoversFromServer(job);
    if (local.length !== server.length) return true;
    if (local.some((r) => !r.id)) return true;
    return local.some((r) => {
      const s = server.find((x) => x.id === r.id);
      if (!s) return true;
      return (
        r.title.trim() !== s.title ||
        r.from_name.trim() !== s.from_name.trim() ||
        r.from_user_id.trim() !== s.from_user_id.trim() ||
        r.to_name.trim() !== s.to_name.trim() ||
        r.to_user_id.trim() !== s.to_user_id.trim() ||
        r.note.trim() !== s.note ||
        r.done !== s.done
      );
    });
  }

  async function addHandover(job: JobWithDetails) {
    const draft = getHandoverDraft(job);
    const title = draft.title.trim();
    if (!title) return;
    setBusy(true);
    setNotePanelBusy({ jobId: job.id, panel: "handover", action: "add" });
    setError("");
    try {
      await api(`/api/jobs/${job.id}/handovers`, {
        method: "POST",
        body: JSON.stringify({
          title,
          from_name: draft.from_name.trim(),
          from_user_id: draft.from_user_id.trim(),
          to_name: draft.to_name.trim(),
          to_user_id: draft.to_user_id.trim(),
          note: draft.note.trim(),
          done: false,
        }),
      });
      setHandoverDraftByJob((prev) => ({
        ...prev,
        [job.id]: emptyHandoverDraft(),
      }));
      setHandoverComposeByJob((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal tambah handover");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  async function saveHandovers(job: JobWithDetails) {
    const local = getHandoverLocal(job);
    const server = handoversFromServer(job);
    const toUpdate = local.filter((r) => {
      if (!r.id) return false;
      const s = server.find((x) => x.id === r.id);
      if (!s) return true;
      return (
        r.title.trim() !== s.title ||
        r.from_name.trim() !== s.from_name.trim() ||
        r.from_user_id.trim() !== s.from_user_id.trim() ||
        r.to_name.trim() !== s.to_name.trim() ||
        r.to_user_id.trim() !== s.to_user_id.trim() ||
        r.note.trim() !== s.note ||
        r.done !== s.done
      );
    });
    if (!toUpdate.length) return;

    setBusy(true);
    setNotePanelBusy({ jobId: job.id, panel: "handover", action: "save" });
    setError("");
    try {
      for (const row of toUpdate) {
        if (!row.id || !row.title.trim()) continue;
        await api(`/api/jobs/${job.id}/handovers/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: row.title.trim(),
            from_name: row.from_name.trim(),
            from_user_id: row.from_user_id.trim(),
            to_name: row.to_name.trim(),
            to_user_id: row.to_user_id.trim(),
            note: row.note.trim(),
            done: row.done,
          }),
        });
      }
      setHandoverLocalByJob((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan handover");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  async function removeHandover(jobId: string, handoverKey: string, handoverId?: string) {
    setBusy(true);
    setNotePanelBusy({ jobId, panel: "handover", action: "delete" });
    setError("");
    try {
      if (handoverId) {
        await api(`/api/jobs/${jobId}/handovers/${handoverId}`, {
          method: "DELETE",
        });
      }
      setHandoverLocalByJob((prev) => {
        const rows = prev[jobId];
        if (!rows) {
          if (!handoverId) return prev;
          const job = jobMap[jobId];
          if (!job) return prev;
          return {
            ...prev,
            [jobId]: handoversFromServer(job).filter((r) => r.id !== handoverId),
          };
        }
        return {
          ...prev,
          [jobId]: rows
            .filter((r) => r.key !== handoverKey)
            .map((r, i) => ({ ...r, order: i + 1 })),
        };
      });
      await invalidateDashboard();
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus handover");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  function getPartLoanDraft(jobId: string) {
    return (
      partLoanDraftByJob[jobId] || {
        part_name: "",
        note: "",
        status: "open" as PartLoanStatus,
      }
    );
  }

  function partLoansFromServer(job: JobWithDetails): PartLoanLocalRow[] {
    return (job.part_loans || []).map((p) => ({
      key: p.id,
      id: p.id,
      part_name: p.part_name,
      note: p.note,
      status: p.status,
      order: p.order,
    }));
  }

  function getPartLoanLocal(job: JobWithDetails): PartLoanLocalRow[] {
    return partLoanLocalByJob[job.id] || partLoansFromServer(job);
  }

  function setPartLoanLocal(
    job: JobWithDetails,
    updater: (rows: PartLoanLocalRow[]) => PartLoanLocalRow[]
  ) {
    setPartLoanLocalByJob((prev) => ({
      ...prev,
      [job.id]: updater(prev[job.id] || partLoansFromServer(job)),
    }));
  }

  function isPartLoanDirty(job: JobWithDetails): boolean {
    const local = partLoanLocalByJob[job.id];
    if (!local) return false;
    const server = partLoansFromServer(job);
    if (local.length !== server.length) return true;
    return local.some((r) => {
      const s = server.find((x) => x.id === r.id);
      if (!s) return true;
      return (
        r.part_name.trim() !== s.part_name ||
        r.note.trim() !== s.note ||
        r.status !== s.status
      );
    });
  }

  async function addPartLoan(job: JobWithDetails) {
    const draft = getPartLoanDraft(job.id);
    const part_name = draft.part_name.trim();
    if (!part_name) return;
    setBusy(true);
    setNotePanelBusy({ jobId: job.id, panel: "part-loan", action: "add" });
    setError("");
    try {
      await api(`/api/jobs/${job.id}/part-loans`, {
        method: "POST",
        body: JSON.stringify({
          part_name,
          note: draft.note.trim(),
          status: "open",
        }),
      });
      setPartLoanDraftByJob((prev) => ({
        ...prev,
        [job.id]: { part_name: "", note: "", status: "open" },
      }));
      setPartLoanComposeByJob((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal tambah peminjaman part");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  async function savePartLoans(job: JobWithDetails) {
    const local = getPartLoanLocal(job);
    const server = partLoansFromServer(job);
    const toUpdate = local.filter((r) => {
      if (!r.id) return false;
      const s = server.find((x) => x.id === r.id);
      if (!s) return true;
      return (
        r.part_name.trim() !== s.part_name ||
        r.note.trim() !== s.note ||
        r.status !== s.status
      );
    });
    if (!toUpdate.length) return;

    setBusy(true);
    setNotePanelBusy({ jobId: job.id, panel: "part-loan", action: "save" });
    setError("");
    try {
      for (const row of toUpdate) {
        if (!row.id || !row.part_name.trim()) continue;
        await api(`/api/jobs/${job.id}/part-loans/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            part_name: row.part_name.trim(),
            note: row.note.trim(),
            status: row.status,
          }),
        });
      }
      setPartLoanLocalByJob((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan peminjaman part");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  async function removePartLoan(
    jobId: string,
    loanKey: string,
    loanId?: string
  ) {
    setBusy(true);
    setNotePanelBusy({ jobId, panel: "part-loan", action: "delete" });
    setError("");
    try {
      if (loanId) {
        await api(`/api/jobs/${jobId}/part-loans/${loanId}`, {
          method: "DELETE",
        });
      }
      setPartLoanLocalByJob((prev) => {
        const rows = prev[jobId];
        if (!rows) {
          if (!loanId) return prev;
          const job = jobMap[jobId];
          if (!job) return prev;
          return {
            ...prev,
            [jobId]: partLoansFromServer(job).filter((r) => r.id !== loanId),
          };
        }
        return {
          ...prev,
          [jobId]: rows
            .filter((r) => r.key !== loanKey)
            .map((r, i) => ({ ...r, order: i + 1 })),
        };
      });
      await invalidateDashboard();
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus peminjaman part");
    } finally {
      setBusy(false);
      setNotePanelBusy(null);
    }
  }

  async function createJob() {
    if (!jobFormValid) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<{ id?: string }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          priority: form.priority,
          unit_id: form.unit_id,
          description: form.description.trim(),
          estimated_minutes: Number(form.estimated_minutes),
          steps: parseSteps(form.steps),
          template_id: form.template_id || undefined,
        }),
      });
      const jobId = String(created?.id || "").trim();
      resetForm();
      setTemplatePreview(null);
      closeModal();
      await invalidateDashboard();
      if (jobId) {
        clearJobSearch();
        setJobSectionFilter("queue");
        setJobOwnershipMine(false);
        setJobOwnershipDelegated(false);
        setJobPriorityFilter("");
        jobDeepLink.open(jobId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal buat job");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditJob() {
    if (modal?.type !== "edit" || !jobFormValid) return;
    setBusy(true);
    setError("");
    try {
      const canEditSteps = ["queued", "assigned"].includes(modal.job.status);
      await api(`/api/jobs/${modal.job.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title.trim(),
          priority: form.priority,
          unit_id: form.unit_id,
          description: form.description.trim(),
          estimated_minutes: Number(form.estimated_minutes),
          steps: canEditSteps ? parseSteps(form.steps) : undefined,
        }),
      });
      closeModal();
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update job");
    } finally {
      setBusy(false);
    }
  }

  async function removeJob() {
    if (modal?.type !== "delete-job") return;
    const job = modal.job;
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      closeModal();
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal hapus job");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancelJob() {
    if (modal?.type !== "cancel-job") return;
    await runAction(modal.job.id, "cancel");
  }

  async function confirmTechStatus() {
    if (modal?.type !== "tech-status") return;
    const { tech, nextStatus } = modal;
    setBusy(true);
    setError("");
    try {
      await api(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      closeModal();
      await invalidateDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal update teknisi");
    } finally {
      setBusy(false);
    }
  }

  function openTechStatusModal(tech: Technician) {
    if (!canSetTechPresence || tech.status === "busy") return;
    const nextStatus: Exclude<TechnicianStatus, "busy"> =
      tech.status === "available" ? "offline" : "available";
    setModal({ type: "tech-status", tech, nextStatus });
  }

  function renderJob(job: JobWithDetails) {
    const manage = canManageJob(job);
    const assignOk = canAssignForJob(job);
    const progressOk = canProgressForJob(job);
    const notesWriteOk = canNotesWriteForJob(job);
    const notesDeleteOk = canNotesDeleteForJob(job);
    const handoverOk = notesWriteOk;
    const delegateOk = canDelegateForJob(job);
    const jobMapLocal = jobMap;
    const activeStepId = job.steps.find((s) => s.status === "in_progress")?.id;
    const jobPriority = normalizeJobPriority(job.priority);
    return (
      <article
        className={`job${
          jobDeepLink.jobId && job.id === jobDeepLink.jobId
            ? " job-deep-link-target"
            : ""
        }`}
        key={job.id}
        id={`job-${job.id}`}
      >
        <SliderActiveStepScroll job={job} />
        <div className="job-head">
          <div>
            <div className="job-title-row">
              <button
                className="btn btn-icon"
                style={{ width: 32, height: 32, minWidth: 32 }}
                disabled={busy || !manage}
                onClick={() => openEdit(job)}
                aria-label="Edit job"
                title="Edit"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <div className="job-title">{job.title}</div>
              {jobPriority ? (
                <span
                  className={`job-priority-pill job-priority-pill--${jobPriority.toLowerCase()}`}
                >
                  {jobPriority}
                </span>
              ) : null}
            </div>
            <div className="job-unit">
              {job.unit}
            </div>
            <div className="job-tech-row">
              {["queued", "assigned", "in_progress", "paused"].includes(
                job.status
              ) && (
                <button
                  className="btn btn-icon"
                  style={{ width: 32, height: 32, minWidth: 32 }}
                  disabled={
                    busy ||
                    !assignOk ||
                    (job.status === "queued" && availableTechs.length === 0)
                  }
                  onClick={() => openAssign(job)}
                  aria-label={
                    job.status === "queued" ? "Assign teknisi" : "Ubah teknisi"
                  }
                  title={
                    !assignOk
                      ? "Hanya pengendali job / foreman (antrian kosong)"
                      : job.status === "queued"
                        ? "Assign teknisi"
                        : "Ubah teknisi"
                  }
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
              <div className="tech-names">
                {job.technicians?.length
                  ? job.technicians.map((t) => t.name).join(", ")
                  : job.technician?.name || "Belum diassign"}
                {job.technicians?.length > 1 ? ` (${job.technicians.length} teknisi)` : ""}
              </div>
            </div>
            {delegateOk && (
              <div className="job-delegate-row">
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                  disabled={busy}
                  onClick={() => void openDelegate(job)}
                  title="Delegasikan ke foreman lain"
                >
                  Delegasi
                </button>
              </div>
            )}
            {(job.assigned_by_user_name || job.delegated_to_user_name) && (
              <p className="job-ownership-meta">
                {job.assigned_by_user_name
                  ? `Penugas: ${job.assigned_by_user_name}`
                  : ""}
                {job.delegated_to_user_name
                  ? `${job.assigned_by_user_name ? " · " : ""}Delegasi: ${job.delegated_to_user_name}`
                  : ""}
              </p>
            )}
          </div>
          {["in_progress", "paused", "done"].includes(job.status) && (
            <div className="job-timer-wrap">
              <LiveTimer job={jobMapLocal[job.id] || job} />
              <div className="job-timer-remain-row">
                {job.status === "in_progress" && (
                  <button
                    className="btn job-timer-action"
                    style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                    disabled={busy || !progressOk}
                    onClick={() => setModal({ type: "pause-job", job })}
                    title={
                      progressOk
                        ? "Pause job"
                        : "Hanya pengendali job yang dapat pause job"
                    }
                  >
                    Pause
                  </button>
                )}
                {job.status === "paused" && (
                  <button
                    className="btn btn-primary job-timer-action"
                    style={{ padding: "6px 10px", fontSize: "0.82rem" }}
                    disabled={busy || !progressOk}
                    onClick={() => setModal({ type: "resume-job", job })}
                    title={
                progressOk
                  ? "Resume job"
                  : "Hanya pengendali job yang dapat resume job"
                    }
                  >
                    Resume
                  </button>
                )}
                <RemainingTimerCard job={jobMapLocal[job.id] || job} />
              </div>
            </div>
          )}
        </div>

        {job.description && (
          <p className="job-description">{job.description}</p>
        )}

        <div className="job-status-row" style={{ marginTop: job.description ? 6 : 10 }}>
          <StatusPill status={job.status} />
          <span className="job-status-meta">
            {t("job.est")} {job.estimated_minutes} {t("common.minutes")} /{" "}
            {Math.floor(Number(job.estimated_minutes || 0) / 60)} {t("common.hours")}{" "}
            {Number(job.estimated_minutes || 0) % 60} {t("common.minutes")} ·{" "}
            {t("job.progress")} {job.progress_pct}%
          </span>
        </div>

        <div className="progress">
          <span style={{ width: `${job.progress_pct}%` }} />
        </div>

        {["assigned", "in_progress"].includes(job.status) && progressOk && (
          <div className="step-mode-toggle" role="group" aria-label="Mode step">
            <button
              type="button"
              className={`btn btn-mode${getStepMode(job.id) === "sequential" ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => setStepMode(job.id, "sequential")}
            >
              {t("job.sequential")}
            </button>
            <button
              type="button"
              className={`btn btn-mode${getStepMode(job.id) === "parallel" ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => setStepMode(job.id, "parallel")}
            >
              {t("job.parallel")}
            </button>
            <span className="step-hint">
              {getStepMode(job.id) === "sequential"
                ? t("job.sequentialHint")
                : t("job.parallelHint")}
            </span>
          </div>
        )}

        <ul className="steps">
          {job.steps.map((s) => {
            const parallel = getStepMode(job.id) === "parallel";
            const selected = (selectedStepsByJob[job.id] || []).includes(s.id);
            return (
              <li
                key={s.id}
                id={
                  s.id === activeStepId ? `job-step-active-${job.id}` : undefined
                }
                className={`step-row status-${s.status}`}
              >
                {job.status === "in_progress" &&
                parallel &&
                s.status === "pending" &&
                progressOk ? (
                  <label className="step-check" title="Pilih untuk start parallel">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busy}
                      onChange={(e) =>
                        toggleStepSelect(job.id, s.id, e.target.checked)
                      }
                    />
                  </label>
                ) : (
                  <span className={`mark ${s.status}`} />
                )}
                <span className="step-main">
                  <span className="step-name-row">
                    <span className="step-name">
                      {s.order}. {s.name}
                      {s.status === "in_progress" ? " (aktif)" : ""}
                      {Number(s.std_minutes || 0) > 0 && (
                        <span className="step-stp" title="STP / Std Hours">
                          {" "}
                          · {t("job.stpStdHours")}: {formatStdLabel(Number(s.std_minutes))}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`step-note-btn${
                        stepHasNote(s) ? " has-note" : ""
                      }`}
                      disabled={busy}
                      onClick={() => {
                        setStepNoteDraft("");
                        setStepNoteEditingId("");
                        setStepNotePdfDraft(null);
                        setStepNotePdfRemove(false);
                        setModal({ type: "step-note", job, step: s });
                      }}
                      title={
                        stepHasNote(s)
                          ? t("job.stepNoteEdit")
                          : t("job.stepNote")
                      }
                      aria-label={t("job.stepNote")}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M8 13h8" />
                        <path d="M8 17h5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`step-photo-btn${
                        stepHasPhoto(s) || stepPhotoDisplayUrl(s)
                          ? " has-photo"
                          : ""
                      }`}
                      disabled={busy}
                      onClick={() => {
                        setStepPhotoDrafts([]);
                        setStepPhotoRemoveIds([]);
                        setModal({ type: "step-photo", job, step: s });
                      }}
                      title={
                        stepHasPhoto(s)
                          ? t("job.stepPhotoEdit")
                          : t("job.stepPhoto")
                      }
                      aria-label={t("job.stepPhoto")}
                    >
                      {stepPhotoDisplayUrl(s) || firstStepThumbUrl(s) ? (
                        <>
                          <img
                            src={stepPhotoDisplayUrl(s) || firstStepThumbUrl(s)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          {stepPhotoCount(s) > 1 ? (
                            <span className="step-photo-count">
                              {stepPhotoCount(s)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      )}
                    </button>
                  </span>
                  {(() => {
                    const techLabel = stepTechnicianNames(s, job);
                    if (!job.technicians?.length && !techLabel) return null;
                    return (
                    <button
                      type="button"
                      className={`step-techs${progressOk ? "" : " is-static"}`}
                      disabled={busy || !progressOk}
                      onClick={() => {
                        if (!progressOk) return;
                        initStepTechnicianIds(job, s);
                        setModal({ type: "step-technicians", job, step: s });
                      }}
                      title={
                        progressOk
                          ? t("job.stepTechniciansEdit")
                          : t("job.stepTechnicians")
                      }
                    >
                      <MetaIcon>👷</MetaIcon>
                      {t("job.technician")}: {techLabel || "—"}
                    </button>
                    );
                  })()}
                  <button
                    type="button"
                    className="step-note-text"
                    disabled={busy}
                    onClick={() => {
                      setStepNoteDraft("");
                      setStepNoteEditingId("");
                      setStepNotePdfDraft(null);
                      setStepNotePdfRemove(false);
                      setModal({ type: "step-note", job, step: s });
                    }}
                    title={t("job.stepNoteEdit")}
                  >
                    <span className="step-note-head">
                      <MetaIcon>📝</MetaIcon>
                      {t("job.stepNote")}
                    </span>
                    {renderStepNoteThread(s, { job })}
                  </button>
                </span>
                <span className="step-meta">
                  <StepDuration
                    step={s}
                    running={
                      job.status === "in_progress" && s.status === "in_progress"
                    }
                  />
                  {job.status === "in_progress" &&
                    s.status === "in_progress" &&
                    canCompleteForStep(job, s) && (
                      <span className="step-actions">
                        <button
                          className="btn btn-step btn-primary"
                          disabled={busy}
                          onClick={() => {
                            initStepTechnicianIds(job, s);
                            setStepPhotoDrafts([]);
                            setStepPhotoRemoveIds([]);
                            setStepNoteDraft("");
                            setStepNoteEditingId("");
                            setModal({ type: "complete-step", job, step: s });
                          }}
                          title="Selesaikan step ini"
                        >
                          Selesai
                        </button>
                      </span>
                    )}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setModal({ type: "print-pdf", job })}
            title="Unduh PDF job (teknisi, steps, handover, peminjaman part)"
          >
            Print PDF
          </button>
          {job.status === "assigned" && (
            <button
              className="btn btn-primary"
              disabled={busy || !progressOk}
              onClick={() => setModal({ type: "start-job", job })}
              title={
                progressOk
                  ? "Start job"
                  : "Hanya pengendali job yang dapat start job"
              }
            >
              Start job
            </button>
          )}
          {job.status === "in_progress" && (
            <div className="actions-spread">
              {getStepMode(job.id) === "parallel" ? (
                <div className="step-batch">
                  <button
                    className="btn btn-primary"
                    disabled={
                      busy ||
                      !progressOk ||
                      !(selectedStepsByJob[job.id] || []).length
                    }
                    onClick={() => {
                      const ids = selectedStepsByJob[job.id] || [];
                      const steps = job.steps.filter((s) => ids.includes(s.id));
                      if (!steps.length) return;
                      setModal({ type: "start-steps", job, steps });
                    }}
                    title="Start semua step yang dicentang sekaligus"
                  >
                    Start terpilih ({(selectedStepsByJob[job.id] || []).length})
                  </button>
                </div>
              ) : (
                <div className="step-batch">
                  {!(job.current_steps?.length || job.current_step) &&
                    job.steps.some((s) => s.status === "pending") && (
                      <button
                        className="btn"
                        disabled={busy || !progressOk}
                        onClick={() => {
                          const next = job.steps.find(
                            (s) => s.status === "pending"
                          );
                          if (!next) return;
                          setModal({ type: "start-next-step", job, step: next });
                        }}
                      >
                        Lanjut step berikutnya
                      </button>
                    )}
                </div>
              )}
              <button
                className="btn btn-primary"
                disabled={busy || !progressOk}
                onClick={() => setModal({ type: "complete-job", job })}
                title={
                  progressOk
                    ? "Complete job"
                    : "Hanya pengendali job yang dapat complete job"
                }
              >
                Complete job
              </button>
            </div>
          )}
          {job.status === "paused" && (
            <button
              className="btn btn-primary"
              disabled={busy || !progressOk}
              onClick={() => setModal({ type: "complete-job", job })}
              title={
                progressOk
                  ? "Complete job"
                  : "Hanya pengendali job yang dapat complete job"
              }
            >
              Complete job
            </button>
          )}
          {(job.status === "done" || job.status === "cancelled") &&
            canJobReopen && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => setModal({ type: "reopen-job", job })}
              title="Buka kembali dari archive (Superuser)"
            >
              Buka kembali
            </button>
          )}
        </div>

        {["in_progress", "paused", "done"].includes(job.status) && (
          <div
            id={`job-handover-${job.id}`}
            className={`handover-panel${
              isNotePanelBusy(job.id, "handover") ? " is-busy" : ""
            }`}
          >
            {isNotePanelBusy(job.id, "handover") && notePanelBusy && (
              <BusyOverlay label={notePanelBusyLabel(notePanelBusy.action)} />
            )}
            <div className="handover-head">
              <h4>
                Catatan handover{" "}
                <span className="handover-count">
                  ({getHandoverLocal(job).length})
                </span>
              </h4>
              {handoverOk &&
              getHandoverLocal(job).length === 0 &&
              !handoverComposeByJob[job.id] ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setHandoverMode(job.id, "tambah");
                    setHandoverComposeByJob((prev) => ({
                      ...prev,
                      [job.id]: true,
                    }));
                    setHandoverDraftByJob((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...emptyHandoverDraft(),
                        title: prev[job.id]?.title || "",
                        note: prev[job.id]?.note || "",
                        to_name: prev[job.id]?.to_name || "",
                        to_user_id: prev[job.id]?.to_user_id || "",
                        from_name:
                          prev[job.id]?.from_name ||
                          emptyHandoverDraft().from_name,
                        from_user_id:
                          prev[job.id]?.from_user_id ||
                          emptyHandoverDraft().from_user_id,
                      },
                    }));
                  }}
                >
                  + Tambah
                </button>
              ) : handoverOk ? (
                <label className="handover-mode">
                  <span>Aksi</span>
                  <select
                    className="handover-select"
                    value={
                      getHandoverMode(job.id) === "hapus" && !notesDeleteOk
                        ? "ubah"
                        : getHandoverMode(job.id)
                    }
                    disabled={busy}
                    onChange={(e) =>
                      setHandoverMode(
                        job.id,
                        e.target.value as "tambah" | "ubah" | "hapus"
                      )
                    }
                  >
                    <option value="tambah">Tambah</option>
                    <option value="ubah">Ubah</option>
                    {notesDeleteOk ? <option value="hapus">Hapus</option> : null}
                  </select>
                </label>
              ) : (
                <span className="step-hint">Hanya lihat</span>
              )}
            </div>
            {handoverOk && (
              <p className="handover-wa-hint">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
                </svg>
                <span>{t("job.handoverWaHint")}</span>
              </p>
            )}
            {handoverOk &&
              getHandoverMode(job.id) === "tambah" &&
              (getHandoverLocal(job).length > 0 ||
                handoverComposeByJob[job.id]) && (
              <div className="handover-add has-to-name">
                <input
                  className="handover-input"
                  placeholder="Job Handover"
                  value={getHandoverDraft(job).title}
                  disabled={busy}
                  onChange={(e) =>
                    setHandoverDraftByJob((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...getHandoverDraft(job),
                        title: e.target.value,
                      },
                    }))
                  }
                />
                {renderHandoverFromField(getHandoverDraft(job).from_name)}
                {renderHandoverToTrigger(
                  job,
                  getHandoverDraft(job).to_name,
                  "draft",
                  getHandoverDraft(job).to_user_id
                )}
                <input
                  className="handover-input"
                  placeholder="Note"
                  value={getHandoverDraft(job).note}
                  disabled={busy}
                  onChange={(e) =>
                    setHandoverDraftByJob((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...getHandoverDraft(job),
                        note: e.target.value,
                      },
                    }))
                  }
                />
                <div className="handover-add-actions">
                  {getHandoverLocal(job).length === 0 && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setHandoverComposeByJob((prev) => {
                          const next = { ...prev };
                          delete next[job.id];
                          return next;
                        });
                        setHandoverDraftByJob((prev) => {
                          const next = { ...prev };
                          delete next[job.id];
                          return next;
                        });
                      }}
                    >
                      Batal
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !getHandoverDraft(job).title.trim()}
                    onClick={() => addHandover(job)}
                  >
                    <BusyLabel
                      busy={isNotePanelBusy(job.id, "handover", "add")}
                      idle="+ Tambah"
                      pending="Menambah..."
                    />
                  </button>
                </div>
              </div>
            )}
            {handoverOk &&
              getHandoverLocal(job).length > 0 &&
              getHandoverMode(job.id) === "ubah" && (
              <div className="handover-actions">
                <span className="step-hint">
                  Edit baris di tabel, lalu Save
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !isHandoverDirty(job)}
                  onClick={() => saveHandovers(job)}
                >
                  <BusyLabel
                    busy={isNotePanelBusy(job.id, "handover", "save")}
                    idle="Save"
                    pending="Menyimpan..."
                  />
                </button>
              </div>
            )}
            {notesDeleteOk &&
              getHandoverLocal(job).length > 0 &&
              getHandoverMode(job.id) === "hapus" && (
              <div className="handover-actions">
                <span className="step-hint">
                  Pilih Hapus pada baris yang ingin dihapus
                </span>
              </div>
            )}
            {getHandoverLocal(job).length > 0 && (
            <div className="handover-table-wrap">
              <table className="handover-table">
                <thead>
                  <tr>
                    <th className="col-no">NO</th>
                    <th>Job Handover</th>
                    <th>{t("job.handoverFrom")}</th>
                    <th>{t("job.handoverTo")}</th>
                    <th className="col-done">Done</th>
                    <th>Note</th>
                    {notesDeleteOk &&
                      getHandoverMode(job.id) === "hapus" && (
                        <th className="col-act" />
                      )}
                  </tr>
                </thead>
                <tbody>
                  {getHandoverLocal(job).map((h) => {
                    const canEdit =
                      handoverOk && getHandoverMode(job.id) === "ubah";
                    return (
                      <tr
                        key={h.key}
                        className={h.done ? "is-done" : ""}
                      >
                        <td className="col-no" data-label="NO">
                          {h.order}
                        </td>
                        <td data-label="Job Handover">
                          {canEdit ? (
                            <input
                              className="handover-input"
                              value={h.title}
                              disabled={busy}
                              onChange={(e) =>
                                setHandoverLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === h.key
                                      ? { ...r, title: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          ) : (
                            h.title
                          )}
                        </td>
                        <td data-label={t("job.handoverFrom")}>
                          {canEdit
                            ? renderHandoverFromField(h.from_name)
                            : h.from_name || "—"}
                        </td>
                        <td data-label={t("job.handoverTo")}>
                          {canEdit ? (
                            renderHandoverToTrigger(
                              job,
                              h.to_name,
                              { key: h.key },
                              h.to_user_id
                            )
                          ) : (
                            h.to_name || "—"
                          )}
                        </td>
                        <td className="col-done" data-label="Done">
                          {canEdit ? (
                            <select
                              className="handover-select"
                              value={h.done ? "1" : "0"}
                              disabled={busy}
                              onChange={(e) =>
                                setHandoverLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === h.key
                                      ? {
                                          ...r,
                                          done: e.target.value === "1",
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              <option value="0">No</option>
                              <option value="1">Yes</option>
                            </select>
                          ) : h.done ? (
                            "Yes"
                          ) : (
                            "No"
                          )}
                        </td>
                        <td data-label="Note">
                          {canEdit ? (
                            <input
                              className="handover-input"
                              placeholder="Note"
                              value={h.note}
                              disabled={busy}
                              onChange={(e) =>
                                setHandoverLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === h.key
                                      ? { ...r, note: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          ) : (
                            h.note || "—"
                          )}
                        </td>
                        {notesDeleteOk &&
                          getHandoverMode(job.id) === "hapus" && (
                            <td className="col-act" data-label="Aksi">
                              <button
                                type="button"
                                className="btn btn-step"
                                disabled={busy}
                                onClick={() =>
                                  setModal({
                                    type: "handover-delete",
                                    job,
                                    handoverKey: h.key,
                                    handoverId: h.id,
                                    order: h.order,
                                    title: h.title,
                                  })
                                }
                              >
                                Hapus
                              </button>
                            </td>
                          )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {["in_progress", "paused", "done"].includes(job.status) && (
          <div
            className={`handover-panel part-loan-panel${
              isNotePanelBusy(job.id, "part-loan") ? " is-busy" : ""
            }`}
          >
            {isNotePanelBusy(job.id, "part-loan") && notePanelBusy && (
              <BusyOverlay label={notePanelBusyLabel(notePanelBusy.action)} />
            )}
            <div className="handover-head">
              <h4>
                Catatan peminjaman part{" "}
                <span className="handover-count">
                  ({getPartLoanLocal(job).length})
                </span>
              </h4>
              {handoverOk &&
              getPartLoanLocal(job).length === 0 &&
              !partLoanComposeByJob[job.id] ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setPartLoanMode(job.id, "tambah");
                    setPartLoanComposeByJob((prev) => ({
                      ...prev,
                      [job.id]: true,
                    }));
                  }}
                >
                  + Tambah
                </button>
              ) : handoverOk ? (
                <label className="handover-mode">
                  <span>Aksi</span>
                  <select
                    className="handover-select"
                    value={
                      getPartLoanMode(job.id) === "hapus" && !notesDeleteOk
                        ? "ubah"
                        : getPartLoanMode(job.id)
                    }
                    disabled={busy}
                    onChange={(e) =>
                      setPartLoanMode(
                        job.id,
                        e.target.value as "tambah" | "ubah" | "hapus"
                      )
                    }
                  >
                    <option value="tambah">Tambah</option>
                    <option value="ubah">Ubah</option>
                    {notesDeleteOk ? <option value="hapus">Hapus</option> : null}
                  </select>
                </label>
              ) : (
                <span className="step-hint">Hanya lihat</span>
              )}
            </div>
            {handoverOk &&
              getPartLoanMode(job.id) === "tambah" &&
              (getPartLoanLocal(job).length > 0 ||
                partLoanComposeByJob[job.id]) && (
              <div className="handover-add">
                <input
                  className="handover-input"
                  placeholder="Part yang dipinjam"
                  value={getPartLoanDraft(job.id).part_name}
                  disabled={busy}
                  onChange={(e) =>
                    setPartLoanDraftByJob((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...getPartLoanDraft(job.id),
                        part_name: e.target.value,
                      },
                    }))
                  }
                />
                <input
                  className="handover-input"
                  placeholder="Note"
                  value={getPartLoanDraft(job.id).note}
                  disabled={busy}
                  onChange={(e) =>
                    setPartLoanDraftByJob((prev) => ({
                      ...prev,
                      [job.id]: {
                        ...getPartLoanDraft(job.id),
                        note: e.target.value,
                      },
                    }))
                  }
                />
                <div className="handover-add-actions">
                  {getPartLoanLocal(job).length === 0 && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setPartLoanComposeByJob((prev) => {
                          const next = { ...prev };
                          delete next[job.id];
                          return next;
                        });
                        setPartLoanDraftByJob((prev) => {
                          const next = { ...prev };
                          delete next[job.id];
                          return next;
                        });
                      }}
                    >
                      Batal
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy || !getPartLoanDraft(job.id).part_name.trim()
                    }
                    onClick={() => addPartLoan(job)}
                  >
                    <BusyLabel
                      busy={isNotePanelBusy(job.id, "part-loan", "add")}
                      idle="+ Tambah"
                      pending="Menambah..."
                    />
                  </button>
                </div>
              </div>
            )}
            {handoverOk &&
              getPartLoanLocal(job).length > 0 &&
              getPartLoanMode(job.id) === "ubah" && (
              <div className="handover-actions">
                <span className="step-hint">
                  Edit baris di tabel, lalu Save
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !isPartLoanDirty(job)}
                  onClick={() => savePartLoans(job)}
                >
                  <BusyLabel
                    busy={isNotePanelBusy(job.id, "part-loan", "save")}
                    idle="Save"
                    pending="Menyimpan..."
                  />
                </button>
              </div>
            )}
            {notesDeleteOk &&
              getPartLoanLocal(job).length > 0 &&
              getPartLoanMode(job.id) === "hapus" && (
              <div className="handover-actions">
                <span className="step-hint">
                  Pilih Hapus pada baris yang ingin dihapus
                </span>
              </div>
            )}
            {getPartLoanLocal(job).length > 0 && (
            <div className="handover-table-wrap">
              <table className="handover-table">
                <thead>
                  <tr>
                    <th className="col-no">NO</th>
                    <th>Part yang dipinjam</th>
                    <th className="col-done">Status</th>
                    <th>Note</th>
                    {notesDeleteOk &&
                      getPartLoanMode(job.id) === "hapus" && (
                        <th className="col-act" />
                      )}
                  </tr>
                </thead>
                <tbody>
                  {getPartLoanLocal(job).map((p) => {
                    const canEdit =
                      handoverOk && getPartLoanMode(job.id) === "ubah";
                    return (
                      <tr
                        key={p.key}
                        className={p.status === "closed" ? "is-done" : ""}
                      >
                        <td className="col-no" data-label="NO">
                          {p.order}
                        </td>
                        <td data-label="Part yang dipinjam">
                          {canEdit ? (
                            <input
                              className="handover-input"
                              value={p.part_name}
                              disabled={busy}
                              onChange={(e) =>
                                setPartLoanLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === p.key
                                      ? { ...r, part_name: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          ) : (
                            p.part_name
                          )}
                        </td>
                        <td className="col-done" data-label="Status">
                          {canEdit ? (
                            <select
                              className="handover-select"
                              value={p.status}
                              disabled={busy}
                              onChange={(e) =>
                                setPartLoanLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === p.key
                                      ? {
                                          ...r,
                                          status: e.target
                                            .value as PartLoanStatus,
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              <option value="open">open</option>
                              <option value="closed">closed</option>
                            </select>
                          ) : (
                            p.status
                          )}
                        </td>
                        <td data-label="Note">
                          {canEdit ? (
                            <input
                              className="handover-input"
                              placeholder="Note"
                              value={p.note}
                              disabled={busy}
                              onChange={(e) =>
                                setPartLoanLocal(job, (rows) =>
                                  rows.map((r) =>
                                    r.key === p.key
                                      ? { ...r, note: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          ) : (
                            p.note || "—"
                          )}
                        </td>
                        {notesDeleteOk &&
                          getPartLoanMode(job.id) === "hapus" && (
                            <td className="col-act" data-label="Aksi">
                              <button
                                type="button"
                                className="btn btn-step"
                                disabled={busy}
                                onClick={() =>
                                  setModal({
                                    type: "part-loan-delete",
                                    job,
                                    loanKey: p.key,
                                    loanId: p.id,
                                    order: p.order,
                                    part_name: p.part_name,
                                  })
                                }
                              >
                                Hapus
                              </button>
                            </td>
                          )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <>
      {glassPortalReady &&
        topbarScrolled &&
        createPortal(
          <div
            className="topbar-glass"
            aria-hidden="true"
            style={
              topbarHeightPx > 0
                ? { height: `${topbarHeightPx}px` }
                : undefined
            }
          />,
          document.body
        )}
      <header className="topbar" ref={topbarRef}>
        <div>
          <div className="brand">
            <div className="brand-row">
              {t("app.title")}
              <OfflineSyncChip
                onRefresh={refreshDashboard}
                refreshBusy={busy}
              />
            </div>
            <span>{t("brand.tagline")}</span>
          </div>
        </div>
        <div className="top-actions">
          <div className="top-actions-panel top-actions-panel--bar">
            <div className={`nav-manage${manageOpen ? " is-open" : ""}`} ref={manageRef}>
              <button
                className="btn"
                type="button"
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={manageOpen}
                onClick={() => {
                  setSessionOpen(false);
                  setManageOpen((o) => !o);
                }}
              >
                {t("nav.manage")}
                <svg
                  className="nav-manage-caret"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {manageOpen && (
                <div className="nav-manage-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "settings" });
                    }}
                  >
                    {t("nav.settings")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setTechImportMsg("");
                      setModal({ type: "techs" });
                    }}
                  >
                    {t("nav.technicians")}
                  </button>
                  {userLevel === "superuser" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-manage-item"
                      disabled={busy}
                      onClick={() => {
                        setManageOpen(false);
                        openUsersMaster();
                      }}
                    >
                      {t("nav.usersMaster")}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy || !canUnitRead}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "units" });
                    }}
                  >
                    {t("nav.unitsMaster")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy || !canTemplateRead}
                    onClick={() => {
                      setManageOpen(false);
                      openTemplatesMaster();
                    }}
                  >
                    {t("nav.templatesMaster")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy}
                    onClick={() => {
                      setManageOpen(false);
                      setModal({ type: "attendance" });
                    }}
                  >
                    {t("nav.attendance")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-manage-item"
                    disabled={busy || !isLoggedIn}
                    title={
                      isLoggedIn
                        ? t("nav.exportExcelTip")
                        : t("nav.exportNeedLogin")
                    }
                    onClick={() => {
                      setManageOpen(false);
                      openExportJobsModal();
                    }}
                  >
                    {t("nav.exportExcel")}
                  </button>
                  {userLevel === "superuser" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-manage-item"
                      disabled={busy}
                      title="Riwayat backup perubahan job (undo)"
                      onClick={() => {
                        setManageOpen(false);
                        void openJobBackupsModal();
                      }}
                    >
                      Backup / Undo
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              className="btn btn-icon"
              disabled={busy}
              type="button"
              onClick={refreshDashboard}
              aria-label={t("nav.refresh")}
              title={t("nav.refresh")}
            >
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
                <path d="M21 12a9 9 0 1 1-2.1-5.7" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <LanguageToggle />
            <button
              className="btn btn-icon"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
              title={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
            >
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
                </svg>
              )}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={() => openCreate()}
            >
              {t("nav.newJob")}
            </button>
            <div className="nav-end">
              {isLoggedIn ? <RemainAlertMuteToggle /> : null}
              <NavAlerts
                enabled={showNavAlerts}
                onBeforeOpen={() => {
                  setManageOpen(false);
                  setSessionOpen(false);
                }}
                onOpenJob={(jobId, kind) => {
                  setManageOpen(false);
                  setSessionOpen(false);
                  jobDeepLink.open(jobId, {
                    focus: kind === "handover" ? "handover" : "",
                  });
                }}
              />
              <div className="nav-session">
                {isLoggedIn ? (
                  <div
                    className={`nav-session-menu${sessionOpen ? " is-open" : ""}`}
                    ref={sessionRef}
                  >
                    <button
                      className="btn nav-account"
                      type="button"
                      disabled={busy || loggingOut}
                      aria-label={t("nav.accountMenu")}
                      aria-haspopup="menu"
                      aria-expanded={sessionOpen}
                      title={`${displayName} · ${userLevel}`}
                      onClick={() => {
                        setManageOpen(false);
                        setSessionOpen((open) => !open);
                      }}
                    >
                      <span className="nav-user">
                        <span className="nav-user-name">{displayNameShort}</span>
                        <span className="nav-user-level">{userLevel}</span>
                      </span>
                      <AccountAvatar url={avatarUrl} size={28} />
                    </button>
                    {sessionOpen && (
                      <div className="nav-manage-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="nav-manage-item"
                          disabled={busy || loggingOut}
                          onClick={() => {
                            setSessionOpen(false);
                            void openEditProfile();
                          }}
                        >
                          {t("nav.editProfile")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="nav-manage-item"
                          disabled={busy || loggingOut}
                          onClick={() => {
                            setSessionOpen(false);
                            openChangePassword();
                          }}
                        >
                          {t("nav.editPassword")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="nav-manage-item"
                          disabled={busy || loggingOut}
                          onClick={() => {
                            setSessionOpen(false);
                            openLogoutConfirm();
                          }}
                        >
                          {t("nav.logout")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    className="btn"
                    disabled={busy || sessionStatus === "loading" || loggingOut}
                    onClick={handleAuthClick}
                  >
                    {t("nav.login")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="top-actions-mobile">
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={() => openCreate()}
            >
              {t("nav.newJobShort")}
            </button>
            <button
              className="btn btn-icon"
              type="button"
              disabled={busy}
              onClick={refreshDashboard}
              aria-label={t("nav.refresh")}
              title={t("nav.refresh")}
            >
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
                <path d="M21 12a9 9 0 1 1-2.1-5.7" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            {isLoggedIn ? <RemainAlertMuteToggle /> : null}
            <NavAlerts
              enabled={showNavAlerts}
              onBeforeOpen={() => setSessionOpen(false)}
              onOpenJob={(jobId, kind) => {
                setMobileMenuOpen(false);
                jobDeepLink.open(jobId, {
                  focus: kind === "handover" ? "handover" : "",
                });
              }}
            />
            <button
              className="btn btn-icon top-menu-toggle"
              type="button"
              aria-label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((o) => !o)}
            >
              {mobileMenuOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <>
          <div
            className="top-menu-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="top-actions-panel top-actions-panel--float is-open">
            {displayName && (
              <div
                className="nav-user nav-user--menu"
                title={`${displayName} · ${userLevel}`}
              >
                <span className="nav-user-text">
                  <span className="nav-user-name">{displayNameShort}</span>
                  <span className="nav-user-level">{userLevel}</span>
                </span>
                {isLoggedIn && (
                  <button
                    className="btn btn-icon"
                    style={{ width: 28, height: 28, minWidth: 28, padding: 0, overflow: "hidden" }}
                    type="button"
                    disabled={busy || loggingOut}
                    aria-label={t("nav.accountMenu")}
                    aria-expanded={sessionOpen}
                    title={t("nav.accountMenu")}
                    onClick={() => setSessionOpen((open) => !open)}
                  >
                    <AccountAvatar url={avatarUrl} size={28} />
                  </button>
                )}
              </div>
            )}
            {isLoggedIn && sessionOpen && (
              <div className="nav-session-actions">
                <button
                  className="btn"
                  disabled={busy || loggingOut}
                  onClick={() => {
                    setSessionOpen(false);
                    setMobileMenuOpen(false);
                    void openEditProfile();
                  }}
                >
                  {t("nav.editProfile")}
                </button>
                <button
                  className="btn"
                  disabled={busy || loggingOut}
                  onClick={() => {
                    setSessionOpen(false);
                    setMobileMenuOpen(false);
                    openChangePassword();
                  }}
                >
                  {t("nav.editPassword")}
                </button>
                <button
                  className="btn"
                  disabled={busy || loggingOut}
                  onClick={() => {
                    setSessionOpen(false);
                    setMobileMenuOpen(false);
                    openLogoutConfirm();
                  }}
                >
                  {t("nav.logout")}
                </button>
              </div>
            )}
            <NavAlerts
              enabled={showNavAlerts}
              variant="menu"
              onOpenJob={(jobId, kind) => {
                setMobileMenuOpen(false);
                setSessionOpen(false);
                jobDeepLink.open(jobId, {
                  focus: kind === "handover" ? "handover" : "",
                });
              }}
            />
            {isLoggedIn ? <RemainAlertMuteToggle variant="menu" /> : null}
            <p className="nav-menu-label">{t("nav.language")}</p>
            <div className="nav-menu-prefs">
              <LanguageToggle />
              <button
                className="btn btn-icon"
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
                title={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
              >
                {theme === "dark" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="nav-menu-label">{t("nav.manage")}</p>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "settings" });
              }}
            >
              {t("nav.settings")}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setTechImportMsg("");
                setModal({ type: "techs" });
              }}
            >
              {t("nav.technicians")}
            </button>
            {userLevel === "superuser" && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setMobileMenuOpen(false);
                  openUsersMaster();
                }}
              >
                {t("nav.usersMaster")}
              </button>
            )}
            <button
              className="btn"
              disabled={busy || !canUnitRead}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "units" });
              }}
            >
              {t("nav.unitsMaster")}
            </button>
            <button
              className="btn"
              disabled={busy || !canTemplateRead}
              onClick={() => {
                setMobileMenuOpen(false);
                openTemplatesMaster();
              }}
            >
              {t("nav.templatesMaster")}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setMobileMenuOpen(false);
                setModal({ type: "attendance" });
              }}
            >
              {t("nav.attendance")}
            </button>
            <button
              className="btn"
              disabled={busy || !isLoggedIn}
              title={
                isLoggedIn
                  ? t("nav.exportExcelTip")
                  : t("nav.exportNeedLogin")
              }
              onClick={() => {
                setMobileMenuOpen(false);
                openExportJobsModal();
              }}
            >
              {t("nav.exportExcel")}
            </button>
            {userLevel === "superuser" && (
              <button
                className="btn"
                disabled={busy}
                title="Riwayat backup perubahan job (undo)"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void openJobBackupsModal();
                }}
              >
                Backup / Undo
              </button>
            )}
            {!isLoggedIn && (
              <button
                className="btn"
                disabled={busy || sessionStatus === "loading" || loggingOut}
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleAuthClick();
                }}
              >
                {t("nav.login")}
              </button>
            )}
          </div>
        </>
      )}

      <main className="app">
      {loggingOut && (
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{t("logout.leaving")}</span>
        </div>
      )}

      {(error || (dashboardError && !data)) && (
        <div className="error">
          {error ||
            (dashboardError instanceof Error
              ? dashboardError.message
              : "Gagal load data")}
        </div>
      )}

      {!data ? (
        persistRestoring || dashboardFetching ? (
          <DashboardShimmer label={t("loading.dashboard")} />
        ) : (
          <p className="empty-state" style={{ padding: "24px 0", color: "var(--muted)" }}>
            {t("offline.noLocalData")}
          </p>
        )
      ) : (
        <>
          <div className="summary-wrap">
            <section className="summary-group">
              <h3 className="summary-title">{t("summary.technicians")}</h3>
              <div className="summary">
                <div className="stat stat--available">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="available" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.available")}</div>
                    <div className="value">{data.summary.available}</div>
                  </div>
                </div>
                <div className="stat stat--busy">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="busy" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.busy")}</div>
                    <div className="value">{data.summary.busy}</div>
                  </div>
                </div>
                <div className="stat stat--offline">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="offline" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.offline")}</div>
                    <div className="value">{data.summary.offline}</div>
                  </div>
                </div>
              </div>
            </section>
            <section className="summary-group">
              <h3 className="summary-title">{t("summary.jobs")}</h3>
              <div className="summary">
                <div className="stat stat--active">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="active" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.activeJobs")}</div>
                    <div className="value">{data.summary.active_jobs}</div>
                  </div>
                </div>
                <div className="stat stat--queue">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="queue" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.queue")}</div>
                    <div className="value">{data.summary.queued_jobs}</div>
                  </div>
                </div>
                <div className="stat stat--done">
                  <span className="stat-icon" aria-hidden="true">
                    <StatIcon kind="done" />
                  </span>
                  <div className="stat-body">
                    <div className="label">{t("summary.completed")}</div>
                    <div className="value">{data.summary.completed_jobs}</div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div
            className={`grid${hideTechPanel || hideJobPanel ? " grid--single" : ""}`}
          >
            {hideTechPanel ? (
              <section className="panel panel--collapsed">
                <div className="panel-vis-bar">
                  <span className="panel-vis-label">{t("panel.techHidden")}</span>
                  <button
                    type="button"
                    className="btn btn-icon panel-vis-btn"
                    onClick={toggleHideTechPanel}
                    aria-label={t("panel.showTech")}
                    title={t("panel.show")}
                  >
                    <PanelToggleIcon collapsed />
                  </button>
                </div>
              </section>
            ) : (
            <section className="panel">
              <div className="panel-vis-bar">
                <label className="panel-filter">
                  <span className="panel-vis-label">{t("panel.filter")}</span>
                  <select
                    value={techStatusFilter}
                    onChange={(e) =>
                      setTechStatusFilter(e.target.value as TechStatusFilter)
                    }
                    aria-label={t("panel.filterTechStatus")}
                  >
                    <option value="all">{t("panel.all")}</option>
                    <option value="available">available</option>
                    <option value="busy">busy</option>
                    <option value="offline">offline</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-icon panel-vis-btn"
                  onClick={toggleHideTechPanel}
                  aria-label={t("panel.hideTech")}
                  title={t("panel.hide")}
                >
                  <PanelToggleIcon collapsed={false} />
                </button>
              </div>
              <div className="panel-head">
                <h2>Teknisi</h2>
                <div className="panel-search-row">
                  <input
                    className="panel-search"
                    type="search"
                    value={techDraft}
                    onChange={(e) => setTechDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyTechSearch();
                      }
                    }}
                    placeholder="Cari nama atau SN..."
                    aria-label="Cari teknisi"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyTechSearch}
                  >
                    Cari
                  </button>
                  {techQuery && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearTechSearch}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <div
                className={`tech-cols${techStatusFilter !== "all" ? " tech-cols--single" : ""}`}
              >
                {(
                  techStatusFilter === "all"
                    ? (["available", "busy", "offline"] as TechnicianStatus[])
                    : [techStatusFilter]
                ).map((status) => {
                  const query = techQueries[status];
                  const pageItems = query.data?.items || [];
                  const total = query.data?.total ?? 0;
                  const totalPages = query.data?.totalPages ?? 1;
                  const page = Math.min(techPage[status], totalPages);
                  return (
                  <div className="tech-col" key={status}>
                    <h3>
                      {status} ({total})
                    </h3>
                    {query.isLoading && pageItems.length === 0 && (
                      <div className="meta">Memuat...</div>
                    )}
                    {pageItems.map((t) => {
                      return (
                        <div className="tech" key={t.id}>
                          <div className="name">{t.name}</div>
                          <div className="meta">
                            {t.sn}
                            {t.current_job_title ? ` · ${t.current_job_title}` : ""}
                          </div>
                          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <StatusPill status={t.status} />
                            {t.status !== "busy" && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                                disabled={busy || !canSetTechPresence}
                                onClick={() => openTechStatusModal(t)}
                              >
                                {t.status === "available" ? "Set offline" : "Set available"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!query.isLoading && pageItems.length === 0 && (
                      <div className="meta">
                        {techQuery ? "Tidak cocok" : "Tidak ada"}
                      </div>
                    )}
                    {totalPages > 1 && (
                      <Pager
                        page={page}
                        totalPages={totalPages}
                        onChange={(next) =>
                          setTechPage((p) => ({ ...p, [status]: next }))
                        }
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            </section>
            )}

            {hideJobPanel ? (
              <section className="panel panel--collapsed">
                <div className="panel-vis-bar">
                  <span className="panel-vis-label">{t("panel.jobHidden")}</span>
                  <button
                    type="button"
                    className="btn btn-icon panel-vis-btn"
                    onClick={toggleHideJobPanel}
                    aria-label={t("panel.showJob")}
                    title={t("panel.show")}
                  >
                    <PanelToggleIcon collapsed />
                  </button>
                </div>
              </section>
            ) : (
            <section className="panel">
              <div className="panel-vis-bar">
                <div className="panel-vis-filters">
                  <label className="panel-filter">
                    <span className="panel-vis-label">{t("panel.filter")}</span>
                    <select
                      value={jobSectionFilter}
                      onChange={(e) =>
                        setJobSectionFilter(e.target.value as JobSectionFilter)
                      }
                      aria-label={t("panel.filterJobSection")}
                    >
                      <option value="all">All</option>
                      <option value="active">{t("job.section.active")}</option>
                      <option value="queue">{t("job.section.queue")}</option>
                      <option value="done">{t("job.section.done")}</option>
                      <option value="cancelled">{t("job.section.cancelled")}</option>
                    </select>
                  </label>
                  {(jobSectionFilter === "all" ||
                    jobSectionFilter === "active" ||
                    jobSectionFilter === "queue") && (
                    <label className="panel-filter panel-filter--priority">
                      <span className="panel-vis-label">
                        {t("panel.filterJobPriority")}
                      </span>
                      <select
                        value={jobPriorityFilter}
                        onChange={(e) =>
                          setJobPriorityFilter(
                            e.target.value as JobPriorityFilter
                          )
                        }
                        aria-label={t("panel.filterJobPriority")}
                      >
                        <option value="">{t("panel.priorityAll")}</option>
                        {JOB_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {isLoggedIn && userId && userLevel !== "teknisi" && (
                    <div
                      className="panel-filter panel-filter--ownership"
                      role="group"
                      aria-label={t("panel.filterJobOwnership")}
                    >
                      <span className="panel-vis-label">
                        {t("panel.filterJobOwnership")}
                      </span>
                      <div className="panel-ownership-options">
                        <label className="panel-ownership-check">
                          <input
                            type="checkbox"
                            checked={jobOwnershipMine}
                            onChange={(e) => setJobOwnershipMine(e.target.checked)}
                          />
                          {t("panel.jobOwnershipMine")}
                        </label>
                        <label className="panel-ownership-check">
                          <input
                            type="checkbox"
                            checked={jobOwnershipDelegated}
                            onChange={(e) =>
                              setJobOwnershipDelegated(e.target.checked)
                            }
                          />
                          {t("panel.jobOwnershipDelegated")}
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-icon panel-vis-btn"
                  onClick={toggleHideJobPanel}
                  aria-label={t("panel.hideJob")}
                  title={t("panel.hide")}
                >
                  <PanelToggleIcon collapsed={false} />
                </button>
              </div>
              {isLoggedIn ? <RemainAlertWatcher jobs={sliderJobs} /> : null}
              <ActiveJobSlider jobs={sliderJobs} renderJob={renderJob}>
                <div className="panel-head">
                  <div className="panel-head-title-row">
                    <h2>
                      {jobSectionFilter === "active"
                        ? t("panel.activeJobsProgress")
                        : jobSectionFilter === "queue"
                          ? t("job.section.queue")
                          : jobSectionFilter === "done"
                            ? t("job.section.done")
                            : jobSectionFilter === "cancelled"
                              ? t("job.section.cancelled")
                              : t("panel.activeJobsProgress")}
                    </h2>
                    {(jobSectionFilter === "all" ||
                      jobSectionFilter === "active") && (
                      <ActiveJobSliderToggle />
                    )}
                  </div>
                  {jobDeepLink.jobId && (
                    <div className="job-deep-link-banner">
                      <span>
                        {jobDeepLink.missing
                          ? t("job.deepLinkMissing")
                          : t("job.deepLinkHint")}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={jobDeepLink.clear}
                      >
                        {t("job.deepLinkClear")}
                      </button>
                    </div>
                  )}
                  <div className="panel-search-row">
                    <input
                      className="panel-search"
                      type="search"
                      value={jobDraft}
                      onChange={(e) => setJobDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyJobSearch();
                        }
                      }}
                      placeholder="Cari job, unit, teknisi..."
                      aria-label="Cari job"
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={applyJobSearch}
                    >
                      Cari
                    </button>
                    {jobQuery && (
                      <button
                        type="button"
                        className="btn"
                        onClick={clearJobSearch}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              {(jobSectionFilter === "all" || jobSectionFilter === "active") && (
                <>
                  {activeJobsQuery.isLoading && activeJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>Memuat...</p>
                  )}
                  {!activeJobsQuery.isLoading && activeJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {liveJobListHasFilter ? t("panel.activeNoMatch") : t("panel.activeEmpty")}
                    </p>
                  )}
                  {activeJobs.map(renderJob)}
                  {activeJobTotalPages > 1 && (
                    <Pager
                      page={activeJobPageSafe}
                      totalPages={activeJobTotalPages}
                      onChange={setActiveJobPage}
                    />
                  )}
                </>
              )}

              {(jobSectionFilter === "all" || jobSectionFilter === "queue") && (
                <>
                  {jobSectionFilter === "all" && (
                    <h2 style={{ marginTop: 22 }}>{t("job.section.queue")}</h2>
                  )}
                  {queueJobsQuery.isLoading && queuedJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>Memuat...</p>
                  )}
                  {!queueJobsQuery.isLoading && queuedJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {liveJobListHasFilter ? t("panel.queueNoMatch") : t("panel.queueEmpty")}
                    </p>
                  )}
                  {queuedJobs.map(renderJob)}
                  {queueJobTotalPages > 1 && (
                    <Pager
                      page={queueJobPageSafe}
                      totalPages={queueJobTotalPages}
                      onChange={setQueueJobPage}
                    />
                  )}
                </>
              )}

              {(jobSectionFilter === "all" || jobSectionFilter === "done") && (
                <>
                  {jobSectionFilter === "all" && (
                    <h2 style={{ marginTop: 22 }}>{t("job.section.done")}</h2>
                  )}
                  {completedJobsQuery.isLoading && completedJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>Memuat...</p>
                  )}
                  {!completedJobsQuery.isLoading && completedJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {jobListHasFilter
                        ? t("panel.doneNoMatch")
                        : t("panel.doneEmptyArchive")}
                    </p>
                  )}
                  {completedJobs.map(renderJob)}
                  {(completedJobTotalPages > 1 || completedJobHasNext) && (
                    <ArchivePager
                      page={completedJobPage}
                      total={completedJobTotal}
                      totalPages={completedJobTotalPages}
                      hasNext={completedJobHasNext}
                      onPrev={goCompletedArchivePrev}
                      onNext={goCompletedArchiveNext}
                    />
                  )}
                </>
              )}

              {(jobSectionFilter === "all" ||
                jobSectionFilter === "cancelled") && (
                <>
                  {jobSectionFilter === "all" && (
                    <h2 style={{ marginTop: 22 }}>{t("job.section.cancelled")}</h2>
                  )}
                  {cancelledJobsQuery.isLoading && historyJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>Memuat...</p>
                  )}
                  {!cancelledJobsQuery.isLoading && historyJobs.length === 0 && (
                    <p style={{ color: "var(--muted)" }}>
                      {jobListHasFilter
                        ? t("panel.cancelledNoMatch")
                        : t("panel.cancelledEmptyArchive")}
                    </p>
                  )}
                  {historyJobs.map(renderJob)}
                  {(cancelledJobTotalPages > 1 || cancelledJobHasNext) && (
                    <ArchivePager
                      page={cancelledJobPage}
                      total={cancelledJobTotal}
                      totalPages={cancelledJobTotalPages}
                      hasNext={cancelledJobHasNext}
                      onPrev={goCancelledArchivePrev}
                      onNext={goCancelledArchiveNext}
                    />
                  )}
                </>
              )}
              </ActiveJobSlider>
            </section>
            )}
          </div>
        </>
      )}

      {modal?.type === "export-jobs" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("export.title")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {t("export.hint")}
            </p>
            <div className="form">
              <label>
                {t("export.scope")}
                <select
                  value={exportForm.scope}
                  disabled={busy}
                  onChange={(e) =>
                    setExportForm((prev) => ({
                      ...prev,
                      scope: e.target.value as "active" | "queue",
                    }))
                  }
                >
                  <option value="active">{t("export.scopeActive")}</option>
                  <option value="queue">{t("export.scopeQueue")}</option>
                </select>
              </label>
              <label>
                {t("export.dateField")}
                <select
                  value={exportForm.dateField}
                  disabled={busy}
                  onChange={(e) =>
                    setExportForm((prev) => ({
                      ...prev,
                      dateField: e.target.value as
                        | "created"
                        | "started"
                        | "completed",
                    }))
                  }
                >
                  <option value="created">{t("export.dateCreated")}</option>
                  <option value="started">{t("export.dateStarted")}</option>
                  <option value="completed">{t("export.dateCompleted")}</option>
                </select>
              </label>
              <label>
                {t("export.from")}
                <input
                  type="date"
                  value={exportForm.dateFrom}
                  disabled={busy}
                  onChange={(e) =>
                    setExportForm((prev) => ({
                      ...prev,
                      dateFrom: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                {t("export.to")}
                <input
                  type="date"
                  value={exportForm.dateTo}
                  disabled={busy}
                  onChange={(e) =>
                    setExportForm((prev) => ({
                      ...prev,
                      dateTo: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <p className="step-hint" style={{ marginTop: 8 }}>
              {t("export.hintDates")}
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                {t("job.cancelAction")}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => requestExportJobsReport()}
              >
                <BusyLabel
                  busy={busy}
                  idle={t("export.action")}
                  pending={t("export.exporting")}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "job-backups" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            {(busy || backupsLoading) && (
              <BusyOverlay label={busy ? "Memproses..." : "Memuat backup..."} />
            )}
            <h3>Backup perubahan job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Snapshot tersimpan di database (<code>job_change_backups</code>).
              Undo mengembalikan data sebelum perubahan (superuser).
            </p>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                fontSize: "0.9rem",
              }}
            >
              <input
                type="checkbox"
                checked={jobBackupsIncludeUndone}
                disabled={busy || backupsFetching}
                onChange={(e) => {
                  setJobBackupsIncludeUndone(e.target.checked);
                }}
              />
              Tampilkan yang sudah di-undo
            </label>
            {jobBackups.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>Belum ada entri backup.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Aksi</th>
                      <th>Ringkasan</th>
                      <th>Oleh</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobBackups.map((row) => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                          {row.at?.replace("T", " ").slice(0, 19)}
                        </td>
                        <td>
                          <code>
                            {row.action}/{row.entity}
                          </code>
                        </td>
                        <td>
                          {row.summary}
                          {row.job_id ? (
                            <div
                              style={{ color: "var(--muted)", fontSize: "0.8rem" }}
                            >
                              {row.job_id}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ fontSize: "0.85rem" }}>
                          {row.user_name || "—"}
                          {row.user_level ? ` · ${row.user_level}` : ""}
                          {row.undone === "1" ? (
                            <div style={{ color: "var(--amber)" }}>sudah undo</div>
                          ) : null}
                        </td>
                        <td>
                          {row.undone !== "1" && userLevel === "superuser" ? (
                            <button
                              type="button"
                              className="btn btn-step"
                              disabled={busy}
                              onClick={() => void undoJobBackup(row.id)}
                            >
                              Undo
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="actions">
              <button
                className="btn"
                disabled={busy || backupsFetching}
                onClick={() => void refetchBackups()}
              >
                Refresh
              </button>
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "export-jobs-confirm" && (
        <div className="modal-backdrop" onClick={() => setModal({ type: "export-jobs" })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("export.title")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {exportForm.scope === "active"
                ? t("export.scopeActive")
                : t("export.scopeQueue")}
            </p>
            <p style={{ margin: "0 0 16px" }}>{t("export.confirm")}</p>
            <div className="actions">
              <button
                className="btn"
                onClick={() => setModal({ type: "export-jobs" })}
                disabled={busy}
              >
                {t("job.cancelAction")}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void exportJobsReport()}
              >
                {t("export.confirmYes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "print-pdf" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("job.printPdf")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              {t("job.printPdfConfirm")}
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                {t("job.cancelAction")}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void printJobPdf(modal.job)}
              >
                {t("job.printPdfYes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "process-alert" && (
        <div
          className="modal-backdrop"
          onClick={
            modal.phase === "loading" ? undefined : closeModal
          }
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            {modal.phase === "loading" ? (
              <div className="process-alert-loading" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                <p style={{ margin: 0, whiteSpace: "pre-line", textAlign: "center" }}>
                  {modal.message}
                </p>
                <span className="step-hint">Mohon tunggu...</span>
              </div>
            ) : (
              <>
                <p
                  style={{
                    margin: "0 0 16px",
                    whiteSpace: "pre-line",
                    color:
                      modal.phase === "error"
                        ? "var(--red)"
                        : "var(--green)",
                  }}
                >
                  {modal.message}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={closeModal}
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modal?.type === "logout" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label={t("logout.leavingShort")} />}
            <h3>{t("logout.title")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {displayName
                ? `${displayName} · ${userLevel}`
                : t("logout.currentAccount")}
            </p>
            <p style={{ margin: "0 0 16px" }}>{t("logout.body")}</p>
            <div className="actions">
              <button
                className="btn"
                onClick={closeModal}
                disabled={busy || loggingOut}
              >
                {t("logout.no")}
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || loggingOut}
                onClick={() => void handleLogout()}
              >
                <BusyLabel
                  busy={loggingOut}
                  idle={t("logout.confirm")}
                  pending={t("logout.leavingShort")}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "edit-profile" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && (
              <BusyOverlay
                label={
                  profileForm.name || profileForm.email || profileForm.phone
                    ? t("profile.saving")
                    : t("profile.loading")
                }
              />
            )}
            <h3>{t("profile.title")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {t("profile.hint")}
            </p>
            {error && <div className="error">{error}</div>}
            {profileChangeMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>
                {profileChangeMsg}
              </p>
            )}
            <div className="form">
              <div>
                <span style={{ display: "block", marginBottom: 8 }}>
                  {t("profile.photo")}
                </span>
                <div className="profile-photo-row">
                  <div className="profile-photo-preview">
                    {profilePhotoDraft?.previewUrl ||
                    (!profilePhotoRemoved && profilePhotoUrl) ? (
                      <img
                        src={
                          profilePhotoDraft?.previewUrl || profilePhotoUrl
                        }
                        alt=""
                      />
                    ) : (
                      <PersonIcon size={32} />
                    )}
                  </div>
                  <div className="profile-photo-actions">
                    <input
                      ref={profilePhotoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(e) =>
                        void onPickProfilePhoto(e.target.files?.[0])
                      }
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => profilePhotoInputRef.current?.click()}
                    >
                      {t("profile.photoPick")}
                    </button>
                    {(profilePhotoDraft ||
                      (!profilePhotoRemoved && profilePhotoUrl)) && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setProfilePhotoDraft(null);
                          setProfilePhotoRemoved(true);
                        }}
                      >
                        {t("profile.photoRemove")}
                      </button>
                    )}
                  </div>
                </div>
                <span className="field-hint">{t("profile.photoHint")}</span>
              </div>
              <label>
                {t("profile.name")}
                <input
                  value={profileForm.name}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, name: e.target.value })
                  }
                  autoComplete="name"
                  autoFocus
                />
              </label>
              <label>
                {t("profile.email")}
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, email: e.target.value })
                  }
                  autoComplete="email"
                />
              </label>
              <label>
                {t("profile.phone")}
                <input
                  type="tel"
                  value={profileForm.phone}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, phone: e.target.value })
                  }
                  autoComplete="tel"
                />
              </label>
              <div className="actions">
                <button className="btn" onClick={closeModal} disabled={busy}>
                  Tutup
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void saveOwnProfile()}
                >
                  <BusyLabel
                    busy={busy}
                    idle={t("profile.save")}
                    pending={t("profile.saving")}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "change-password" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memperbarui password..." />}
            <h3>Update password</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Masukkan password saat ini dan password baru minimal 6 karakter.
            </p>
            {error && <div className="error">{error}</div>}
            {passwordChangeMsg && (
              <p style={{ color: "var(--green)", marginTop: 0 }}>
                {passwordChangeMsg}
              </p>
            )}
            <div className="form">
              <label>
                Password saat ini *
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      currentPassword: e.target.value,
                    })
                  }
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
              <label>
                Password baru *
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      newPassword: e.target.value,
                    })
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                Konfirmasi password baru *
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      confirmPassword: e.target.value,
                    })
                  }
                  autoComplete="new-password"
                />
              </label>
              {passwordForm.confirmPassword &&
                passwordForm.newPassword !== passwordForm.confirmPassword && (
                  <p className="error" style={{ margin: 0 }}>
                    Konfirmasi password baru belum cocok.
                  </p>
                )}
              <div className="actions">
                <button className="btn" onClick={closeModal} disabled={busy}>
                  Tutup
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !passwordForm.currentPassword ||
                    passwordForm.newPassword.length < 6 ||
                    passwordForm.newPassword !== passwordForm.confirmPassword
                  }
                  onClick={saveOwnPassword}
                >
                  <BusyLabel
                    busy={busy}
                    idle="Update password"
                    pending="Memperbarui..."
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(modal?.type === "create" || modal?.type === "edit") && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className={`modal${modal.type === "create" ? " modal-wide" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay label="Menyimpan..." />}
            {modal.type === "edit" ? (
              <div className="modal-header">
                <h3>Edit job</h3>
                <div className="modal-header-actions">
                  {!["done", "cancelled"].includes(modal.job.status) && (
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy || !modalManageOk}
                      onClick={() =>
                        setModal({ type: "cancel-job", job: modal.job })
                      }
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={
                      busy ||
                      !canDeleteForJob(modal.job) ||
                      modal.job.status === "done"
                    }
                    onClick={() =>
                      setModal({ type: "delete-job", job: modal.job })
                    }
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <h3>Job baru</h3>
            )}
            <div className="form">
              {modal.type === "create" && (
                <>
                  <label>
                    Mode input
                    <select
                      value={form.mode}
                      onChange={(e) => {
                        const mode = e.target.value as "template" | "custom";
                        setTemplatePreview(null);
                        if (mode === "custom") {
                          setForm({
                            mode,
                            category: "",
                            template_id: "",
                            steps: "Diagnosis\nPerbaikan\nTest & QC",
                            estimated_minutes: "90",
                            title: "",
                            description: "",
                          });
                        } else {
                          setForm({
                            mode,
                            category: "",
                            template_id: "",
                            steps: "",
                            estimated_minutes: "90",
                            title: "",
                            description: "",
                          });
                        }
                      }}
                    >
                      <option value="template">Dari time frame (template)</option>
                      <option value="custom">Custom (manual)</option>
                    </select>
                  </label>
                  {form.mode === "template" && (
                    <>
                      <label>
                        Jenis Template *
                        <select
                          value={form.category}
                          onChange={(e) => {
                            const category = e.target.value as
                              | JobTemplateCategory
                              | "";
                            setTemplatePreview(null);
                            setForm({
                              category,
                              template_id: "",
                              title: "",
                              steps: "",
                              estimated_minutes: "90",
                              description: "",
                            });
                          }}
                          required
                        >
                          <option value="">Pilih Template</option>
                          <option value="engine">Component Engine</option>
                          <option value="non_engine">
                            Component Non Engine (Transmisi)
                          </option>
                          <option value="goh">GOH</option>
                        </select>
                      </label>
                      <label>
                        Template Komponen/GOH Unit *
                        <SearchableSelect
                          value={form.template_id}
                          disabled={!form.category || templatesLoading}
                          required
                          placeholder={
                            templatesLoading
                              ? "Memuat template..."
                              : "Pilih Komponen / Unit"
                          }
                          emptyMessage="Tidak ada template yang cocok"
                          aria-label="Template Komponen/GOH Unit"
                          options={templateSummaries.map((t) => ({
                            value: t.id,
                            label: `${t.name} · ${t.step_count} step · ${formatStdLabel(t.std_minutes)}`,
                            searchText: `${t.name} ${t.id}`,
                          }))}
                          onChange={(next) => void applyJobTemplate(next)}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              <label>
                Judul *
                <input
                  value={form.title}
                  onChange={(e) => setForm({ title: e.target.value })}
                  required
                />
              </label>
              <label>
                {t("job.priority")}
                <select
                  value={form.priority || ""}
                  onChange={(e) => setForm({ priority: e.target.value })}
                >
                  <option value="">{t("job.priorityNone")}</option>
                  {JOB_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit *
                <SearchableSelect
                  value={form.unit_id}
                  required
                  placeholder="Pilih Komponen / Unit"
                  emptyMessage="Tidak ada unit yang cocok"
                  aria-label="Unit"
                  options={(data?.units || [])
                    .filter(
                      (u) =>
                        u.active === "1" ||
                        (modal.type === "edit" && u.id === form.unit_id)
                    )
                    .map((u) => ({
                      value: u.id,
                      label: `${u.code} — ${u.name}${
                        u.active !== "1" ? " (nonaktif)" : ""
                      }`,
                      searchText: `${u.code} ${u.name} ${u.serial_number || ""}`,
                    }))}
                  onChange={(next) => setForm({ unit_id: next })}
                />
              </label>
              <label>
                Deskripsi *
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ description: e.target.value })}
                  required
                />
              </label>
              <label>
                Estimasi (menit) *
                <input
                  type="number"
                  min={1}
                  value={form.estimated_minutes}
                  onChange={(e) =>
                    setForm({ estimated_minutes: e.target.value })
                  }
                  readOnly={isTemplateCreate && Boolean(form.template_id)}
                  required
                />
                {isTemplateCreate && form.template_id && (
                  <span className="field-hint">
                    Standar time frame:{" "}
                    {formatStdLabel(Number(form.estimated_minutes) || 0)}
                  </span>
                )}
              </label>
              {modal.type === "create" &&
                form.mode === "template" &&
                templatePreview && (
                  <div className="template-preview">
                    <div className="template-preview-head">
                      Tahapan dari template ({templatePreview.steps.length})
                    </div>
                    <div className="template-preview-body">
                      {(() => {
                        const phases: {
                          phase: string;
                          steps: typeof templatePreview.steps;
                        }[] = [];
                        for (const step of templatePreview.steps
                          .slice()
                          .sort((a, b) => a.order - b.order)) {
                          const key = step.phase || "General";
                          const last = phases[phases.length - 1];
                          if (!last || last.phase !== key) {
                            phases.push({ phase: key, steps: [step] });
                          } else {
                            last.steps.push(step);
                          }
                        }
                        return phases.map(({ phase, steps }) => (
                          <div key={phase} className="template-phase">
                            <div className="template-phase-title">{phase}</div>
                            <ul>
                              {steps.map((s) => (
                                <li key={s.id}>
                                  <span>{s.name}</span>
                                  <span className="template-step-min">
                                    {s.std_minutes > 0
                                      ? formatStdLabel(s.std_minutes)
                                      : "—"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              {(modal.type === "edit" ||
                (modal.type === "create" && form.mode === "custom")) &&
                (modal.type === "create" ||
                  ["queued", "assigned"].includes(modal.job.status)) && (
                  <label>
                    Tahapan (satu baris per step) *
                    <textarea
                      rows={4}
                      value={form.steps}
                      onChange={(e) => setForm({ steps: e.target.value })}
                      placeholder={"Diagnosis\nPerbaikan\nTest & QC"}
                      required
                    />
                  </label>
                )}
              {modal.type === "edit" &&
                !["queued", "assigned"].includes(modal.job.status) && (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                    Tahapan tidak bisa diubah karena job sudah berjalan.
                  </p>
                )}
              <div className="actions">
                <button className="btn" onClick={closeModal} disabled={busy}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !jobFormValid ||
                    (modal.type === "edit" && modal.job.status === "done")
                  }
                  onClick={modal.type === "create" ? createJob : saveEditJob}
                >
                  <BusyLabel
                    busy={busy}
                    idle={modal.type === "create" ? "Simpan" : "Update"}
                    pending="Menyimpan..."
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "assign" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay />}
            <h3>
              {modal.job.status === "queued"
                ? "Assign teknisi"
                : "Ubah teknisi"}
            </h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — pilih satu atau lebih
            </p>
            <div className="form">
              <label>
                Cari teknisi
                <div className="panel-search-row" style={{ justifyContent: "stretch", marginTop: 4 }}>
                  <input
                    className="panel-search"
                    style={{ maxWidth: "none" }}
                    type="search"
                    value={assignDraft}
                    onChange={(e) => setAssignDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyAssignSearch();
                      }
                    }}
                    placeholder="Nama atau SN..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyAssignSearch}
                  >
                    Cari
                  </button>
                  {assignQuery && (
                    <button
                      type="button"
                      className="btn"
                      onClick={clearAssignSearch}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </label>
              <div className="check-list check-list-paged">
                {assignPoolQuery.isLoading && assignSelectableTechs.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>Memuat...</span>
                )}
                {!assignPoolQuery.isLoading && assignSelectableTechs.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    {assignQuery
                      ? "Tidak ada teknisi yang cocok"
                      : "Tidak ada teknisi available"}
                  </span>
                )}
                {pagedAssignTechs.map((t) => {
                  const checked = assignTechIds.includes(t.id);
                  return (
                    <label className="check-item" key={t.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignTech(t.id)}
                      />
                      <span>
                        {t.name}
                        <span style={{ color: "var(--muted)" }}> — {t.sn}</span>
                        {t.id === assignTechIds[0] ? " · lead" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              {assignSelectableTechs.length > TECH_PAGE_SIZE && (
                <Pager
                  page={assignPickerPageSafe}
                  totalPages={assignPickerTotalPages}
                  onChange={setAssignPickerPage}
                />
              )}
              <div className="assign-check-meta">
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                  Teknisi pertama yang dicentang menjadi lead. Dipilih: {assignTechIds.length}
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={assignTechIds.length === 0}
                  onClick={clearAssignTechs}
                >
                  {t("job.assignUncheckAll")}
                </button>
              </div>
              <div className="actions">
                <button className="btn" onClick={closeModal}>
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || assignTechIds.length === 0}
                  onClick={() =>
                    setModal({
                      type: "confirm-assign",
                      job: modal.job,
                      techIds: [...assignTechIds],
                    })
                  }
                >
                  Assign ({assignTechIds.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "tech-status" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>Ubah status teknisi</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.tech.name} — {modal.tech.sn}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Ubah status dari{" "}
              <strong>{modal.tech.status}</strong> menjadi{" "}
              <strong>{modal.nextStatus}</strong>?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={confirmTechStatus}
              >
                <BusyLabel
                  busy={busy}
                  idle={`Ya, set ${modal.nextStatus}`}
                  pending="Menyimpan..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "confirm-assign" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "assign", job: modal.job })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>
              {modal.job.status === "queued"
                ? "Konfirmasi assign"
                : "Konfirmasi ubah teknisi"}
            </h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              {modal.job.status === "queued"
                ? `Assign ${modal.techIds.length} teknisi ke job ini?`
                : `Ubah teknisi job ini menjadi ${modal.techIds.length} orang?`}
            </p>
            <ul style={{ margin: "0 0 16px", paddingLeft: 18, color: "var(--muted)" }}>
              {modal.techIds.map((id, index) => {
                const tech = assignTechLookup.get(id);
                return (
                  <li key={id}>
                    {tech?.name || id}
                    {tech?.sn ? ` — ${tech.sn}` : ""}
                    {index === 0 ? " · lead" : ""}
                  </li>
                );
              })}
            </ul>
            <div className="actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => setModal({ type: "assign", job: modal.job })}
              >
                Kembali
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  runAction(modal.job.id, "assign", {
                    technician_ids: modal.techIds,
                  })
                }
              >
                <BusyLabel
                  busy={busy}
                  idle={
                    modal.job.status === "queued"
                      ? `Ya, assign (${modal.techIds.length})`
                      : `Ya, ubah (${modal.techIds.length})`
                  }
                  pending="Memproses..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delegate-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Delegasi job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Kendali job dialihkan penuh ke foreman yang dipilih. Penugas asli
              tidak bisa manage atau mencabut delegasi. Superuser tetap bisa.
            </p>
            <label style={{ display: "block", marginBottom: 16 }}>
              Foreman
              <select
                className="panel-search"
                style={{ maxWidth: "none", width: "100%", marginTop: 6 }}
                value={delegateForemanId}
                disabled={busy}
                onChange={(e) => setDelegateForemanId(e.target.value)}
              >
                <option value="">— Pilih foreman —</option>
                {foremanOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.username}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              {modal.job.delegated_to_user_id && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => runAction(modal.job.id, "undelegate")}
                >
                  Cabut delegasi
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={busy || !delegateForemanId}
                onClick={() =>
                  runAction(modal.job.id, "delegate", {
                    delegate_user_id: delegateForemanId,
                  })
                }
              >
                <BusyLabel busy={busy} idle="Simpan delegasi" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "start-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Start job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              {getStepMode(modal.job.id) === "sequential" ? (
                <>
                  Mulai job dalam mode <strong>Berurutan</strong>? Step pertama
                  akan otomatis aktif.
                </>
              ) : (
                <>
                  Mulai job dalam mode <strong>Parallel</strong>? Setelah start,
                  centang step lalu tekan <strong>Start terpilih</strong>.
                </>
              )}
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !modalProgressOk}
                onClick={() => {
                  const mode = getStepMode(modal.job.id);
                  runAction(modal.job.id, "start", {
                    step_mode: mode,
                    auto_start_first: mode === "sequential",
                  });
                }}
              >
                <BusyLabel busy={busy} idle="Ya, start job" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "start-next-step" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Lanjut step berikutnya</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Start step{" "}
              <strong>
                {modal.step.order}. {modal.step.name}
              </strong>
              ?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !modalProgressOk}
                onClick={() =>
                  runAction(modal.job.id, "start_steps", {
                    step_ids: [modal.step.id],
                    step_mode: "sequential",
                  })
                }
              >
                <BusyLabel busy={busy} idle="Ya, start step" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "start-steps" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Start step terpilih</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              Start <strong>{modal.steps.length}</strong> step sekaligus (mode
              parallel)? Timer semua step mulai pada waktu yang sama.
            </p>
            <ul
              style={{
                margin: "0 0 16px",
                paddingLeft: 18,
                color: "var(--muted)",
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {modal.steps.map((s) => (
                <li key={s.id}>
                  {s.order}. {s.name}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !modalProgressOk}
                onClick={() =>
                  runAction(modal.job.id, "start_steps", {
                    step_ids: modal.steps.map((s) => s.id),
                    step_mode: "parallel",
                  })
                }
              >
                <BusyLabel
                  busy={busy}
                  idle="Ya, start bersamaan"
                  pending="Memproses..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "pause-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Pause job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Pause job ini? Timer akan berhenti sementara dan status menjadi{" "}
              <strong>paused</strong>.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !modalProgressOk}
                onClick={() => runAction(modal.job.id, "pause")}
              >
                <BusyLabel busy={busy} idle="Ya, pause" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "resume-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Resume job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Lanjutkan job ini? Status kembali menjadi{" "}
              <strong>in progress</strong> dan timer berjalan lagi.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !modalProgressOk}
                onClick={() => runAction(modal.job.id, "resume")}
              >
                <BusyLabel busy={busy} idle="Ya, resume" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "complete-step" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Selesai step</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Tandai step{" "}
              <strong>
                {modal.step.order}. {modal.step.name}
              </strong>{" "}
              sebagai selesai?
              {getStepMode(modal.job.id) === "sequential" &&
                (modal.job.current_steps?.length || 0) <= 1 && (
                  <>
                    {" "}
                    Step berikutnya akan <strong>otomatis dimulai</strong>.
                  </>
                )}
            </p>
            {renderStepTechnicianPicker(modal.job, {
              locked: !modalProgressOk,
            })}
            <div className="step-note-thread step-note-thread--modal">
              <span className="step-note-head">
                <MetaIcon>📝</MetaIcon>
                {t("job.stepNote")}
              </span>
              {renderStepNoteThread(modal.step, { job: modal.job })}
            </div>
            <label className="field-hint" style={{ display: "block", margin: "12px 0 6px" }}>
              {t("job.stepNoteAdd")}
              {!stepHasNote(modal.step) ? " *" : ""}
            </label>
            <p className="field-hint" style={{ marginTop: 0 }}>
              {t("job.stepNoteRequired")}
            </p>
            <textarea
              className="step-note-field"
              value={stepNoteDraft}
              placeholder={t("job.stepNotePlaceholder")}
              disabled={busy || !modalCompleteOk}
              maxLength={4000}
              rows={4}
              onChange={(e) => setStepNoteDraft(e.target.value)}
            />
            <StepPhotoPicker
              existing={visibleStepPhotos(modal.step)}
              drafts={stepPhotoDrafts}
              onDraftsChange={setStepPhotoDrafts}
              onRemoveExisting={
                modalCompleteOk
                  ? (id) =>
                      setStepPhotoRemoveIds((prev) =>
                        prev.includes(id) ? prev : [...prev, id]
                      )
                  : undefined
              }
              disabled={busy || !modalCompleteOk}
              required
            />
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !modalCompleteOk ||
                  (modalProgressOk &&
                    (modal.job.technicians?.length || 0) > 0 &&
                    stepTechnicianIds.length === 0) ||
                  !stepHasEvidence(modal.step) ||
                  !stepHasNoteText(modal.step, stepNoteDraft)
                }
                onClick={() => {
                  const mode = getStepMode(modal.job.id);
                  const extraNote = stepNoteDraft.trim().slice(0, 4000);
                  runAction(modal.job.id, "complete_step", {
                    step_id: modal.step.id,
                    step_mode: mode,
                    auto_next: mode === "sequential",
                    ...(extraNote
                      ? { note: extraNote, note_id: newEntityId("SN") }
                      : {}),
                    ...(modalProgressOk && modal.job.technicians?.length
                      ? { technician_ids: stepTechnicianIds }
                      : {}),
                    ...stepPhotoActionPayload(),
                  });
                }}
              >
                <BusyLabel busy={busy} idle="Ya, selesai step" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "step-technicians" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>{t("job.stepTechniciansEdit")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 12px" }}>
              {t("job.steps")}{" "}
              <strong>
                {modal.step.order}. {modal.step.name}
              </strong>
            </p>
            {renderStepTechnicianPicker(modal.job)}
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !modalProgressOk ||
                  stepTechnicianIds.length === 0
                }
                onClick={() =>
                  runAction(modal.job.id, "set_step_technicians", {
                    step_id: modal.step.id,
                    technician_ids: stepTechnicianIds,
                  })
                }
              >
                <BusyLabel
                  busy={busy}
                  idle={t("job.stepTechniciansSave")}
                  pending="Memproses..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "step-note" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal modal-step-note"
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay label="Memproses..." />}
            <div className="modal-body">
            <h3>{t("job.stepNoteEdit")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 12px" }}>
              {t("job.steps")}{" "}
              <strong>
                {modal.step.order}. {modal.step.name}
              </strong>
            </p>
            <div className="step-note-thread step-note-thread--modal">
              <span className="step-note-head">
                <MetaIcon>📝</MetaIcon>
                {t("job.stepNote")}
              </span>
              {renderStepNoteThread(modal.step, {
                allowEdit: true,
                job: modal.job,
              })}
            </div>
            {stepNoteEditingId ? (
              <p className="field-hint" style={{ marginTop: 0 }}>
                {t("job.stepNoteChangeHint")}
              </p>
            ) : (
              <p className="field-hint" style={{ marginTop: 0 }}>
                {t("job.stepNoteHint")} {t("job.stepNoteRequired")}
              </p>
            )}
            <label
              className="field-hint"
              style={{ display: "block", margin: "0 0 6px" }}
            >
              {stepNoteEditingId
                ? t("job.stepNoteChange")
                : t("job.stepNoteAdd")}
            </label>
            <textarea
              className="step-note-field"
              value={stepNoteDraft}
              placeholder={t("job.stepNotePlaceholder")}
              disabled={
                busy ||
                (stepNoteEditingId
                  ? !canNotesDeleteForJob(modal.job)
                  : !modalEvidenceOk)
              }
              maxLength={4000}
              rows={4}
              onChange={(e) => setStepNoteDraft(e.target.value)}
            />
            {(() => {
              const liveStep =
                jobMap[modal.job.id]?.steps.find((s) => s.id === modal.step.id) ||
                modal.step;
              const editing = stepNoteEditingId
                ? notesForStepDisplay(liveStep, modal.job.id).find(
                    (n) => n.id === stepNoteEditingId
                  )
                : undefined;
              const pdfLocked = stepNoteEditingId
                ? !canNotesDeleteForJob(modal.job)
                : !modalEvidenceOk;
              return (
                <StepNotePdfPicker
                  existingName={editing?.file_original_name}
                  existingUrl={editing?.file_url}
                  draft={stepNotePdfDraft}
                  removed={stepNotePdfRemove}
                  disabled={busy || pdfLocked}
                  onDraftChange={(d) => {
                    setStepNotePdfDraft(d);
                    if (d) setStepNotePdfRemove(false);
                  }}
                  onRemoveExisting={
                    editing?.file_id || editing?.file_name
                      ? () => {
                          setStepNotePdfDraft(null);
                          setStepNotePdfRemove(true);
                        }
                      : undefined
                  }
                />
              );
            })()}
            </div>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                {t("job.cancelAction")}
              </button>
              {stepNoteEditingId ? (
                <>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setStepNoteEditingId("");
                      setStepNoteDraft("");
                      setStepNotePdfDraft(null);
                      setStepNotePdfRemove(false);
                    }}
                  >
                    {t("job.stepNoteChangeCancel")}
                  </button>
                  {canNotesDeleteForJob(modal.job) && (
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        !stepNoteDraft.trim() ||
                        (stepNoteDraft.trim() ===
                          (hydrateStepNotes(modal.step).find(
                            (n) => n.id === stepNoteEditingId
                          )?.body || "") &&
                          !stepNotePdfDraft &&
                          !stepNotePdfRemove)
                      }
                      onClick={() =>
                        runAction(modal.job.id, "edit_step_note", {
                          step_id: modal.step.id,
                          note_id: stepNoteEditingId,
                          note: stepNoteDraft.trim().slice(0, 4000),
                          edited_by_name: displayName,
                          edited_by_user_id: userId,
                          ...(stepNotePdfDraft
                            ? {
                                file_base64: stepNotePdfDraft.base64,
                                file_mime: stepNotePdfDraft.mime,
                                file_name: stepNotePdfDraft.name,
                              }
                            : stepNotePdfRemove
                              ? { remove_file: true }
                              : {}),
                        })
                      }
                    >
                      <BusyLabel
                        busy={busy}
                        idle={t("job.stepNoteChangeSave")}
                        pending={t("job.saving")}
                      />
                    </button>
                  )}
                </>
              ) : (
                modalEvidenceOk && (
                  <button
                    className="btn btn-primary"
                    disabled={busy || !stepNoteDraft.trim()}
                    onClick={() =>
                      runAction(modal.job.id, "set_step_note", {
                        step_id: modal.step.id,
                        note: stepNoteDraft.trim().slice(0, 4000),
                        note_id: newEntityId("SN"),
                        ...(stepNotePdfDraft
                          ? {
                              file_base64: stepNotePdfDraft.base64,
                              file_mime: stepNotePdfDraft.mime,
                              file_name: stepNotePdfDraft.name,
                            }
                          : {}),
                      })
                    }
                  >
                    <BusyLabel
                      busy={busy}
                      idle={t("job.stepNoteSave")}
                      pending={t("job.saving")}
                    />
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {modal?.type === "step-photo" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>{t("job.stepPhotoEdit")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 12px" }}>
              {t("job.steps")}{" "}
              <strong>
                {modal.step.order}. {modal.step.name}
              </strong>
            </p>
            <StepPhotoPicker
              existing={visibleStepPhotos(modal.step)}
              drafts={stepPhotoDrafts}
              onDraftsChange={setStepPhotoDrafts}
              onRemoveExisting={
                modalEvidenceOk
                  ? (id) =>
                      setStepPhotoRemoveIds((prev) =>
                        prev.includes(id) ? prev : [...prev, id]
                      )
                  : undefined
              }
              disabled={busy || !modalEvidenceOk}
              required
            />
            {modal.step.photo_updated_by_name ? (
              <p className="field-hint">
                {t("job.stepPhotoBy", { name: modal.step.photo_updated_by_name })}
              </p>
            ) : null}
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                {t("job.cancelAction")}
              </button>
              {modalEvidenceOk && (
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    (stepPhotoDrafts.length === 0 &&
                      stepPhotoRemoveIds.length === 0)
                  }
                  onClick={() =>
                    runAction(modal.job.id, "set_step_photo", {
                      step_id: modal.step.id,
                      ...stepPhotoActionPayload(),
                    })
                  }
                >
                  <BusyLabel
                    busy={busy}
                    idle={t("job.stepPhotoSave")}
                    pending={t("job.saving")}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal?.type === "complete-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Complete job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Selesaikan seluruh job ini? Job dipindah ke arsip{" "}
              <strong>completed</strong> di database dan dihapus dari daftar
              aktif. Teknisi akan dilepas.
            </p>
            {modal.job.steps.some(
              (s) => s.status !== "done" && !stepHasPhoto(s)
            ) && (
              <p className="field-hint" style={{ color: "var(--error-text)" }}>
                {t("job.completeNeedPhotos")}{" "}
                {modal.job.steps
                  .filter((s) => s.status !== "done" && !stepHasPhoto(s))
                  .map((s) => `${s.order}. ${s.name}`)
                  .join(", ")}
              </p>
            )}
            {modal.job.steps.some(
              (s) => s.status !== "done" && !stepHasNoteText(s)
            ) && (
              <p className="field-hint" style={{ color: "var(--error-text)" }}>
                {t("job.completeNeedNotes")}{" "}
                {modal.job.steps
                  .filter((s) => s.status !== "done" && !stepHasNoteText(s))
                  .map((s) => `${s.order}. ${s.name}`)
                  .join(", ")}
              </p>
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !modalProgressOk ||
                  modal.job.steps.some(
                    (s) => s.status !== "done" && !stepHasPhoto(s)
                  ) ||
                  modal.job.steps.some(
                    (s) => s.status !== "done" && !stepHasNoteText(s)
                  )
                }
                onClick={() => runAction(modal.job.id, "complete")}
              >
                <BusyLabel busy={busy} idle="Ya, complete" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "reopen-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Buka kembali job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Buka kembali job dari arsip{" "}
              {modal.job.status === "cancelled" ? "cancelled" : "completed"} di
              database? Job dikembalikan ke daftar aktif
              {modal.job.status === "done" || modal.job.started_at
                ? " dengan status paused"
                : modal.job.technicians?.length
                  ? " dengan status assigned"
                  : " dengan status queued"}
              .
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canJobReopen}
                onClick={() => runAction(modal.job.id, "reopen")}
              >
                <BusyLabel
                  busy={busy}
                  idle="Ya, buka kembali"
                  pending="Memproses..."
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "handover-to" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal modal-handover-to" onClick={(e) => e.stopPropagation()}>
            <h3>{t("job.handoverTo")}</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <label style={{ display: "block", marginBottom: 8 }}>
              Cari
              <input
                className="panel-search"
                style={{ maxWidth: "none", width: "100%", marginTop: 6 }}
                type="search"
                value={handoverToQuery}
                onChange={(e) => setHandoverToQuery(e.target.value)}
                placeholder={t("job.handoverToSearch")}
                autoFocus
                disabled={handoverToLoading}
              />
            </label>
            <div className="handover-to-list" role="listbox">
              {handoverToLoading && (
                <span className="handover-to-empty">
                  {t("job.handoverToLoading")}
                </span>
              )}
              {!handoverToLoading &&
                handoverToFiltered.length === 0 && (
                  <span className="handover-to-empty">
                    {t("job.handoverToEmpty")}
                  </span>
                )}
              {!handoverToLoading &&
                pagedHandoverTo.map((u) => {
                  const label = userDisplayName(u);
                  const selected = modal.currentUserId
                    ? u.id === modal.currentUserId
                    : label === modal.current ||
                      u.username === modal.current ||
                      (u.name || "").trim() === modal.current;
                  const showUser =
                    u.username &&
                    u.username.toLowerCase() !== label.toLowerCase();
                  const levelLabel =
                    u.level === "teknisi"
                      ? t("job.handoverToLevelTeknisi")
                      : t("job.handoverToLevelForeman");
                  return (
                    <button
                      type="button"
                      key={u.id}
                      role="option"
                      aria-selected={selected}
                      className={`handover-to-option${selected ? " is-selected" : ""}`}
                      onClick={() => applyHandoverTo(u)}
                    >
                      <span>{label}</span>
                      <span className="handover-to-option-meta">
                        {showUser ? `${u.username} · ` : ""}
                        {levelLabel}
                      </span>
                    </button>
                  );
                })}
            </div>
            {handoverToFiltered.length > TECH_PAGE_SIZE && (
              <Pager
                page={handoverToPageSafe}
                totalPages={handoverToTotalPages}
                onChange={setHandoverToPage}
              />
            )}
            <div className="actions">
              <button className="btn" onClick={closeModal}>
                {t("job.cancelAction")}
              </button>
              {modal.current ? (
                <button
                  className="btn"
                  onClick={() => applyHandoverTo(null)}
                >
                  {t("job.handoverToNone")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {modal?.type === "handover-delete" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && (
              <BusyOverlay
                label={
                  isNotePanelBusy(modal.job.id, "handover", "delete")
                    ? "Menghapus..."
                    : "Memproses..."
                }
              />
            )}
            <h3>Hapus catatan handover</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus item{" "}
              <strong>
                #{modal.order} {modal.title}
              </strong>
              ?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || !canNotesDeleteForJob(modal.job)}
                onClick={() =>
                  removeHandover(
                    modal.job.id,
                    modal.handoverKey,
                    modal.handoverId
                  )
                }
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "part-loan-delete" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && (
              <BusyOverlay
                label={
                  isNotePanelBusy(modal.job.id, "part-loan", "delete")
                    ? "Menghapus..."
                    : "Memproses..."
                }
              />
            )}
            <h3>Hapus peminjaman part</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus item{" "}
              <strong>
                #{modal.order} {modal.part_name}
              </strong>
              ?
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Batal
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || !canNotesDeleteForJob(modal.job)}
                onClick={() =>
                  removePartLoan(modal.job.id, modal.loanKey, modal.loanId)
                }
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "cancel-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Memproses..." />}
            <h3>Cancel job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Batalkan job ini? Job dipindah ke arsip{" "}
              <strong>cancelled</strong> di database dan dihapus dari daftar
              aktif. Teknisi yang terpasang akan dilepas.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmCancelJob}
              >
                <BusyLabel busy={busy} idle="Ya, cancel" pending="Memproses..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-job" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus job</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.job.title} — {modal.job.unit}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus job ini dari daftar aktif? Data lengkap (job, steps, events,
              assignees, handover, part loans) akan di-backup ke arsip{" "}
              <strong>deleted</strong> di database sebelum dihapus.
            </p>
            <div className="actions">
              <button className="btn" onClick={closeModal} disabled={busy}>
                Tidak
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={removeJob}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "units" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-units-title"
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay />}
            <div className="master-head">
              <h3 id="master-units-title">Master Unit</h3>
              <p className="master-lead">
                Data unit dipilih saat buat/edit job. Upload Excel untuk mass
                input — header: Nomor unit, Model, Serial number, Status
                (opsional).
              </p>
              {error && <div className="error">{error}</div>}
              {unitImportMsg && (
                <p style={{ color: "var(--green)", marginTop: 0 }}>
                  {unitImportMsg}
                </p>
              )}
              {canUnitCreate && (
                <details className="master-tools">
                  <summary>Upload / template Excel</summary>
                  <div className="master-tools-body form">
                    <div className="actions" style={{ marginTop: 10 }}>
                      <a
                        className="btn"
                        href="/api/units/template"
                        download="template-upload-unit.xlsx"
                      >
                        Unduh template Excel
                      </a>
                    </div>
                    <label>
                      Mass upload Excel (.xlsx)
                      <input
                        type="file"
                        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) importUnitsFile(file);
                        }}
                      />
                    </label>
                  </div>
                </details>
              )}
              <div
                className="panel-search-row"
                style={{ justifyContent: "stretch" }}
              >
                <input
                  className="panel-search"
                  style={{ maxWidth: "none" }}
                  type="search"
                  value={unitDraft}
                  onChange={(e) => setUnitDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyUnitSearch();
                    }
                  }}
                  placeholder="Cari nomor unit, model, atau serial number..."
                  aria-label="Cari unit"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyUnitSearch}
                >
                  Cari
                </button>
                {unitQuery && (
                  <button
                    type="button"
                    className="btn"
                    onClick={clearUnitSearch}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="master-body">
              <div className="check-list">
                {(data?.units || []).length === 0 && (
                  <span style={{ color: "var(--muted)" }}>Belum ada unit.</span>
                )}
                {(data?.units || []).length > 0 && filteredUnits.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    Tidak ada unit yang cocok.
                  </span>
                )}
                {pagedUnits.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px dashed var(--line-dashed)",
                    }}
                  >
                    <div>
                      <strong>{u.code}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {u.name}
                        {u.serial_number ? ` · SN ${u.serial_number}` : ""}
                        {u.active !== "1" ? " · nonaktif" : ""}
                      </div>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canUnitUpdate}
                        onClick={() => openUnitEdit(u)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canUnitDelete}
                        onClick={() => setModal({ type: "delete-unit", unit: u })}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {filteredUnits.length > MASTER_PAGE_SIZE && (
                <Pager
                  page={unitMasterPageSafe}
                  totalPages={unitMasterTotalPages}
                  onChange={setUnitMasterPage}
                />
              )}
            </div>
            <div className="master-foot actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canUnitCreate}
                onClick={openUnitCreate}
              >
                + Unit baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "unit-import-preview" && (
        <div className="modal-backdrop import-preview-backdrop">
          <div
            className="modal import-preview-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-import-preview-title"
          >
            {busy && <BusyOverlay label="Mengimpor..." />}
            <div className="import-preview-head">
              <h3 id="unit-import-preview-title">Review import unit</h3>
              <p className="import-preview-lead">
                Centang baris OK yang ingin dimasukkan. Baris error tidak bisa
                dipilih.
              </p>
              {error && <div className="error">{error}</div>}
              <div className="import-preview-summary">
                <span className="import-preview-ok">OK: {modal.okCount}</span>
                <span className="import-preview-err">
                  Error: {modal.errorCount}
                </span>
                <span>
                  Dipilih:{" "}
                  {
                    modal.rows.filter((r) => r.ok && modal.selected[r.row])
                      .length
                  }
                </span>
              </div>
              <div className="import-preview-toolbar">
                <label className="import-preview-select-all">
                  <input
                    type="checkbox"
                    checked={
                      modal.okCount > 0 &&
                      modal.rows
                        .filter((r) => r.ok)
                        .every((r) => modal.selected[r.row])
                    }
                    disabled={modal.okCount === 0 || busy}
                    onChange={(e) => {
                      const next: Record<number, boolean> = {
                        ...modal.selected,
                      };
                      for (const r of modal.rows) {
                        if (r.ok) next[r.row] = e.target.checked;
                      }
                      setModal({ ...modal, selected: next });
                    }}
                  />
                  Pilih semua OK
                </label>
              </div>
            </div>
            <div className="import-preview-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Baris</th>
                    <th>Status</th>
                    <th>Aksi</th>
                    <th>Nomor unit</th>
                    <th>Model</th>
                    <th>Serial number</th>
                    <th>Aktif</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {modal.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ color: "var(--muted)" }}>
                        Tidak ada baris data di file.
                      </td>
                    </tr>
                  )}
                  {modal.rows.map((r) => (
                    <tr
                      key={r.row}
                      className={r.ok ? "import-row-ok" : "import-row-err"}
                    >
                      <td>
                        <input
                          type="checkbox"
                          disabled={!r.ok || busy}
                          checked={Boolean(r.ok && modal.selected[r.row])}
                          onChange={(e) => {
                            setModal({
                              ...modal,
                              selected: {
                                ...modal.selected,
                                [r.row]: e.target.checked,
                              },
                            });
                          }}
                          aria-label={`Pilih baris ${r.row}`}
                        />
                      </td>
                      <td>{r.row}</td>
                      <td>
                        <span
                          className={
                            r.ok ? "badge badge-ok" : "badge badge-err"
                          }
                        >
                          {r.ok ? "OK" : "Error"}
                        </span>
                      </td>
                      <td>
                        {r.ok
                          ? r.action === "update"
                            ? "Update"
                            : "Baru"
                          : "—"}
                      </td>
                      <td>{r.code || "—"}</td>
                      <td>{r.name || "—"}</td>
                      <td>{r.serial_number || "—"}</td>
                      <td>
                        {r.active === "0"
                          ? "Nonaktif"
                          : r.active === "1"
                            ? "Aktif"
                            : "—"}
                      </td>
                      <td className="import-preview-note">
                        {r.error || (r.ok ? "Siap diimpor" : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="import-preview-foot actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setModal({ type: "units" });
                }}
              >
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !modal.rows.some((r) => r.ok && modal.selected[r.row])
                }
                onClick={() => void commitUnitImportPreview()}
              >
                Impor terpilih
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "unit-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "units" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "Unit baru" : "Edit unit"}</h3>
            <div className="form">
              <label>
                Nomor unit
                <input
                  value={unitForm.code}
                  onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                  placeholder="Mis. E448"
                  required
                />
              </label>
              <label>
                Model
                <input
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                  placeholder="Mis. D10T"
                  required
                />
              </label>
              <label>
                Serial number
                <input
                  value={unitForm.serial_number}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, serial_number: e.target.value })
                  }
                  placeholder="Mis. CAT-123456"
                  required
                />
              </label>
              {modal.mode === "edit" && (
                <label>
                  Status
                  <select
                    value={unitForm.active}
                    onChange={(e) =>
                      setUnitForm({ ...unitForm, active: e.target.value })
                    }
                  >
                    <option value="1">Aktif</option>
                    <option value="0">Nonaktif</option>
                  </select>
                </label>
              )}
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "units" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !unitForm.code ||
                    !unitForm.name ||
                    !unitForm.serial_number
                  }
                  onClick={saveUnit}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-unit" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "units" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus unit</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.unit.code} — {modal.unit.name}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus unit ini permanen? Jika masih dipakai job, penghapusan
              akan ditolak — nonaktifkan lewat Edit jika perlu.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "units" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteUnit}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "templates" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-templates-title"
            onClick={(e) => e.stopPropagation()}
          >
            {(busy || templatesMasterLoading) && <BusyOverlay />}
            <div className="master-head">
              <h3 id="master-templates-title">Master Template</h3>
              <p className="master-lead">
                Katalog time frame Component Engine / Non Engine / GOH.
                Nonaktif menyembunyikan template dari job baru. Hapus di Edit
                menghapus permanen dari katalog (job lama tetap menyimpan
                template_id).
              </p>
              {error && <div className="error">{error}</div>}
              {templateImportMsg && (
                <p style={{ color: "var(--green)", marginTop: 0 }}>
                  {templateImportMsg}
                </p>
              )}
              {(canTemplateRead || canTemplateCreate) && (
                <details className="master-tools">
                  <summary>Upload / unduh Excel</summary>
                  <div className="master-tools-body form">
                    <div
                      className="actions"
                      style={{ marginTop: 10, flexWrap: "wrap" }}
                    >
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || masterTemplates.length === 0}
                        title="Export semua / filter jenis ke Excel"
                        onClick={() =>
                          void downloadTemplatesDataExcel({
                            category: templateCategoryFilter || undefined,
                          })
                        }
                      >
                        Unduh Excel (data)
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        title="File kosong untuk mass upload"
                        onClick={() => void downloadTemplateUploadExcel()}
                      >
                        Unduh blank upload
                      </button>
                    </div>
                    {canTemplateCreate && (
                      <label>
                        Mass upload Excel (.xlsx)
                        <input
                          type="file"
                          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) importTemplatesFile(file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </details>
              )}
              <div
                className="panel-search-row"
                style={{ justifyContent: "stretch", flexWrap: "wrap" }}
              >
                <select
                  value={templateCategoryFilter}
                  onChange={(e) =>
                    setTemplateCategoryFilter(
                      e.target.value as "" | JobTemplateCategory
                    )
                  }
                  aria-label="Filter jenis komponen"
                  style={{ minWidth: 180 }}
                >
                  <option value="">Semua jenis</option>
                  <option value="engine">Component Engine</option>
                  <option value="non_engine">
                    Component Non Engine (Transmisi)
                  </option>
                  <option value="goh">GOH</option>
                </select>
                <input
                  className="panel-search"
                  style={{ maxWidth: "none", flex: 1 }}
                  type="search"
                  value={templateDraft}
                  onChange={(e) => setTemplateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyTemplateSearch();
                    }
                  }}
                  placeholder="Cari nama atau id template..."
                  aria-label="Cari template"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyTemplateSearch}
                >
                  Cari
                </button>
                {(templateQuery || templateCategoryFilter) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      clearTemplateSearch();
                      setTemplateCategoryFilter("");
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="master-body">
              <div className="check-list">
                {masterTemplates.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    Belum ada template.
                  </span>
                )}
                {masterTemplates.length > 0 &&
                  filteredMasterTemplates.length === 0 && (
                    <span style={{ color: "var(--muted)" }}>
                      Tidak ada template yang cocok.
                    </span>
                  )}
                {pagedMasterTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px dashed var(--line-dashed)",
                    }}
                  >
                    <div>
                      <strong>{tpl.name}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {jobTemplateCategoryLabel(tpl.category)}
                        {" · "}
                        {tpl.steps.length} step ·{" "}
                        {formatStdLabel(tpl.std_minutes)}
                        {tpl.active !== "1" ? " · nonaktif" : ""}
                      </div>
                    </div>
                    <div
                      className="actions"
                      style={{ marginTop: 0, flexWrap: "wrap" }}
                    >
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy}
                        title="Unduh Excel data template ini"
                        onClick={() =>
                          void downloadTemplatesDataExcel({ id: tpl.id })
                        }
                      >
                        Excel
                      </button>
                      <button
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canTemplateUpdate}
                        onClick={() => openTemplateEdit(tpl)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={
                          busy || !canTemplateDelete || tpl.active === "0"
                        }
                        onClick={() =>
                          setModal({
                            type: "delete-template",
                            template: tpl,
                            permanent: false,
                          })
                        }
                      >
                        Nonaktif
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {filteredMasterTemplates.length > MASTER_PAGE_SIZE && (
                <Pager
                  page={templateMasterPageSafe}
                  totalPages={templateMasterTotalPages}
                  onChange={setTemplateMasterPage}
                />
              )}
            </div>
            <div className="master-foot actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canTemplateCreate}
                onClick={openTemplateCreate}
              >
                + Template baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "template-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "templates" })}
        >
          <div
            className="modal modal-template-form"
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay label="Menyimpan..." />}
            <div className="modal-header">
              <h3>
                {modal.mode === "create" ? "Template baru" : "Edit template"}
              </h3>
              {modal.mode === "edit" && modal.template && canTemplateDelete && (
                <div className="modal-header-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      setModal({
                        type: "delete-template",
                        template: modal.template!,
                        permanent: true,
                      })
                    }
                  >
                    Hapus
                  </button>
                </div>
              )}
            </div>
            <div className="modal-body">
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Jenis Template
                <select
                  value={templateForm.category}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      category: e.target.value as JobTemplateCategory,
                    })
                  }
                >
                  <option value="engine">Component Engine</option>
                  <option value="non_engine">
                    Component Non Engine (Transmisi)
                  </option>
                  <option value="goh">GOH</option>
                </select>
              </label>
              <label>
                Nama komponen
                <input
                  value={templateForm.name}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, name: e.target.value })
                  }
                  placeholder="Mis. Engine 3306"
                  required
                />
              </label>
              {modal.mode === "edit" && (
                <label>
                  Status
                  <select
                    value={templateForm.active}
                    onChange={(e) =>
                      setTemplateForm({
                        ...templateForm,
                        active: e.target.value,
                      })
                    }
                  >
                    <option value="1">aktif</option>
                    <option value="0">nonaktif</option>
                  </select>
                </label>
              )}
              {modal.mode === "create" && (
                <label>
                  Salin langkah dari
                  <select
                    value={templateCloneId}
                    onChange={(e) => applyTemplateClone(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">— Kosong / manual —</option>
                    {masterTemplates
                      .filter((t) => t.active === "1")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.steps.length} step)
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="template-form-meta">
                Total estimasi: <strong>{formatStdLabel(templateFormStdMinutes)}</strong>
                {" · "}
                {templateForm.steps.length} step
              </p>
              <div className="template-step-table">
                <div className="template-step-head" aria-hidden="true">
                  <span>Phase</span>
                  <span>Nama step</span>
                  <span>No</span>
                  <span>MP</span>
                  <span>Mnt</span>
                  <span />
                </div>
                {templateForm.steps.map((step, index) => (
                  <div
                    key={step.id || `new-${index}`}
                    className="template-step-row"
                  >
                    <input
                      aria-label={`Phase ${index + 1}`}
                      value={step.phase}
                      onChange={(e) => {
                        const steps = [...templateForm.steps];
                        steps[index] = { ...step, phase: e.target.value };
                        setTemplateForm({ ...templateForm, steps });
                      }}
                      placeholder="Receive"
                    />
                    <input
                      aria-label={`Nama step ${index + 1}`}
                      value={step.name}
                      onChange={(e) => {
                        const steps = [...templateForm.steps];
                        steps[index] = { ...step, name: e.target.value };
                        setTemplateForm({ ...templateForm, steps });
                      }}
                      placeholder="Unpacking"
                      required
                    />
                    <input
                      className="template-step-num"
                      aria-label={`Urutan ${index + 1}`}
                      type="number"
                      min={1}
                      value={step.order}
                      onChange={(e) => {
                        const steps = [...templateForm.steps];
                        steps[index] = {
                          ...step,
                          order: Number(e.target.value) || index + 1,
                        };
                        setTemplateForm({ ...templateForm, steps });
                      }}
                    />
                    <input
                      className="template-step-num"
                      aria-label={`Man power ${index + 1}`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={step.man_power}
                      onChange={(e) => {
                        const steps = [...templateForm.steps];
                        steps[index] = {
                          ...step,
                          man_power: Number(e.target.value) || 0,
                        };
                        setTemplateForm({ ...templateForm, steps });
                      }}
                    />
                    <input
                      className="template-step-num"
                      aria-label={`Menit ${index + 1}`}
                      type="number"
                      min={0}
                      value={step.std_minutes}
                      onChange={(e) => {
                        const steps = [...templateForm.steps];
                        steps[index] = {
                          ...step,
                          std_minutes: Number(e.target.value) || 0,
                        };
                        setTemplateForm({ ...templateForm, steps });
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-danger template-step-remove"
                      disabled={templateForm.steps.length <= 1}
                      aria-label={`Hapus step ${index + 1}`}
                      onClick={() => {
                        const steps = templateForm.steps
                          .filter((_, i) => i !== index)
                          .map((s, i) => ({ ...s, order: i + 1 }));
                        setTemplateForm({ ...templateForm, steps });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            </div>
            <div className="template-form-footer">
              <button
                type="button"
                className="btn template-step-add"
                onClick={() =>
                  setTemplateForm({
                    ...templateForm,
                    steps: [
                      ...templateForm.steps,
                      {
                        phase: "",
                        name: "",
                        order: templateForm.steps.length + 1,
                        man_power: 1,
                        std_minutes: 60,
                      },
                    ],
                  })
                }
              >
                + Tambah step
              </button>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => setModal({ type: "templates" })}
                >
                  Batal
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !templateForm.name.trim() ||
                    templateForm.steps.every((s) => !s.name.trim())
                  }
                  onClick={saveTemplate}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-template" && (
        <div
          className="modal-backdrop"
          onClick={() =>
            modal.permanent
              ? setModal({
                  type: "template-form",
                  mode: "edit",
                  template: modal.template,
                })
              : setModal({ type: "templates" })
          }
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && (
              <BusyOverlay
                label={
                  modal.permanent ? "Menghapus..." : "Menonaktifkan..."
                }
              />
            )}
            <h3>
              {modal.permanent ? "Hapus template" : "Nonaktifkan template"}
            </h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.template.name}
            </p>
            {modal.permanent ? (
              <p style={{ margin: "0 0 16px" }}>
                Template akan dihapus permanen dari katalog. Job yang sudah
                memakai template ini tidak berubah, tetapi template tidak bisa
                dipilih lagi untuk job baru.
              </p>
            ) : (
              <p style={{ margin: "0 0 16px" }}>
                Template akan disembunyikan dari pilihan buat job baru. Job
                yang sudah memakai template ini tidak berubah. Aktifkan lagi
                lewat Edit jika perlu.
              </p>
            )}
            <div className="actions">
              <button
                className="btn"
                onClick={() =>
                  modal.permanent
                    ? setModal({
                        type: "template-form",
                        mode: "edit",
                        template: modal.template,
                      })
                    : setModal({ type: "templates" })
                }
              >
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteTemplate}
              >
                <BusyLabel
                  busy={busy}
                  idle={
                    modal.permanent ? "Ya, hapus" : "Ya, nonaktifkan"
                  }
                  pending={
                    modal.permanent ? "Menghapus..." : "Menonaktifkan..."
                  }
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "techs" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-techs-title"
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay />}
            <div className="master-head">
              <h3 id="master-techs-title">Master Teknisi</h3>
              <p className="master-lead">
                Kelola data teknisi (nama, SN, telepon, status). Sync Meals
                Request (available/offline) ada di <strong>Daftar Hadir</strong>.
              </p>
              {error && <div className="error">{error}</div>}
              {techImportMsg && (
                <p style={{ color: "var(--green)", marginTop: 0 }}>
                  {techImportMsg}
                </p>
              )}
              {canTechCreate && (
                <details className="master-tools">
                  <summary>Upload / template Excel</summary>
                  <div className="master-tools-body form">
                    <div className="actions" style={{ marginTop: 10 }}>
                      <a
                        className="btn"
                        href="/api/technicians/template"
                        download="template-upload-teknisi.xlsx"
                      >
                        Unduh template Excel
                      </a>
                    </div>
                    <label>
                      Mass upload Excel (.xlsx)
                      <input
                        type="file"
                        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) importTechniciansFile(file);
                        }}
                      />
                    </label>
                  </div>
                </details>
              )}
              <div
                className="panel-search-row"
                style={{ justifyContent: "stretch" }}
              >
                <input
                  className="panel-search"
                  style={{ maxWidth: "none" }}
                  type="search"
                  value={masterTechDraft}
                  onChange={(e) => setMasterTechDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyMasterTechSearch();
                    }
                  }}
                  placeholder="Cari nama, SN, atau telepon..."
                  aria-label="Cari teknisi"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyMasterTechSearch}
                >
                  Cari
                </button>
                {masterTechQuery && (
                  <button
                    type="button"
                    className="btn"
                    onClick={clearMasterTechSearch}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="master-body">
              <div className="check-list">
                {masterTechTotal === 0 && !masterTechListQuery.isLoading && (
                  <span style={{ color: "var(--muted)" }}>
                    Belum ada teknisi.
                  </span>
                )}
                {masterTechTotal > 0 &&
                  pagedMasterTechs.length === 0 &&
                  !masterTechListQuery.isLoading && (
                    <span style={{ color: "var(--muted)" }}>
                      Tidak ada teknisi yang cocok.
                    </span>
                  )}
                {pagedMasterTechs.map((tech) => (
                  <div
                    key={tech.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px dashed var(--line-dashed)",
                    }}
                  >
                    <div>
                      <strong>{tech.name}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        Pernr: {tech.sn}
                        {tech.badge_id ? ` · Badge: ${tech.badge_id}` : ""}
                        {tech.email ? ` · ${tech.email}` : ""}
                        {tech.phone ? ` · ${tech.phone}` : ""}
                        {tech.superior_user_name
                          ? ` · Superior: ${tech.superior_user_name}`
                          : ""}
                        {` · ${tech.status}`}
                        {tech.user_id
                          ? ` · ${t("tech.loginReady", { username: tech.sn })}`
                          : ` · ${t("tech.loginMissing")}`}
                      </div>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canTechUpdate}
                        onClick={() => openTechEdit(tech)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={
                          busy || !canTechDelete || tech.status === "busy"
                        }
                        onClick={() => setModal({ type: "delete-tech", tech })}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {masterTechTotalPages > 1 && (
                <Pager
                  page={masterTechPageSafe}
                  totalPages={masterTechTotalPages}
                  onChange={setMasterTechPage}
                />
              )}
            </div>
            <div className="master-foot actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canTechCreate}
                onClick={openTechCreate}
              >
                + Teknisi baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "tech-import-preview" && (
        <div className="modal-backdrop import-preview-backdrop">
          <div
            className="modal import-preview-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tech-import-preview-title"
          >
            {busy && <BusyOverlay label="Mengimpor..." />}
            <div className="import-preview-head">
              <h3 id="tech-import-preview-title">Review import teknisi</h3>
              <p className="import-preview-lead">
                Centang baris OK yang ingin dimasukkan. Baris error tidak bisa
                dipilih.
              </p>
              {error && <div className="error">{error}</div>}
              <div className="import-preview-summary">
                <span className="import-preview-ok">OK: {modal.okCount}</span>
                <span className="import-preview-err">
                  Error: {modal.errorCount}
                </span>
                <span>
                  Dipilih:{" "}
                  {
                    modal.rows.filter((r) => r.ok && modal.selected[r.row])
                      .length
                  }
                </span>
              </div>
              <div className="import-preview-toolbar">
                <label className="import-preview-select-all">
                  <input
                    type="checkbox"
                    checked={
                      modal.okCount > 0 &&
                      modal.rows
                        .filter((r) => r.ok)
                        .every((r) => modal.selected[r.row])
                    }
                    disabled={modal.okCount === 0 || busy}
                    onChange={(e) => {
                      const next: Record<number, boolean> = {
                        ...modal.selected,
                      };
                      for (const r of modal.rows) {
                        if (r.ok) next[r.row] = e.target.checked;
                      }
                      setModal({ ...modal, selected: next });
                    }}
                  />
                  Pilih semua OK
                </label>
              </div>
            </div>
            <div className="import-preview-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Baris</th>
                    <th>Status</th>
                    <th>Aksi</th>
                    <th>Nama</th>
                    <th>SN</th>
                    <th>Badge</th>
                    <th>Email</th>
                    <th>Telepon</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {modal.rows.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ color: "var(--muted)" }}>
                        Tidak ada baris data di file.
                      </td>
                    </tr>
                  )}
                  {modal.rows.map((r) => (
                    <tr
                      key={r.row}
                      className={r.ok ? "import-row-ok" : "import-row-err"}
                    >
                      <td>
                        <input
                          type="checkbox"
                          disabled={!r.ok || busy}
                          checked={Boolean(r.ok && modal.selected[r.row])}
                          onChange={(e) => {
                            setModal({
                              ...modal,
                              selected: {
                                ...modal.selected,
                                [r.row]: e.target.checked,
                              },
                            });
                          }}
                          aria-label={`Pilih baris ${r.row}`}
                        />
                      </td>
                      <td>{r.row}</td>
                      <td>
                        <span
                          className={
                            r.ok ? "badge badge-ok" : "badge badge-err"
                          }
                        >
                          {r.ok ? "OK" : "Error"}
                        </span>
                      </td>
                      <td>
                        {r.ok
                          ? r.action === "update"
                            ? "Update"
                            : "Baru"
                          : "—"}
                      </td>
                      <td>{r.name || "—"}</td>
                      <td>{r.sn || "—"}</td>
                      <td>{r.badge_id || "—"}</td>
                      <td>{r.email || "—"}</td>
                      <td>{r.phone || "—"}</td>
                      <td className="import-preview-note">
                        {r.error || (r.ok ? "Siap diimpor" : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="import-preview-foot actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setModal({ type: "techs" });
                }}
              >
                Batal
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !modal.rows.some((r) => r.ok && modal.selected[r.row])
                }
                onClick={() => void commitTechnicianImportPreview()}
              >
                Impor terpilih
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "tech-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "techs" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "Teknisi baru" : "Edit teknisi"}</h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Nama *
                <input
                  value={techForm.name}
                  onChange={(e) => setTechForm({ ...techForm, name: e.target.value })}
                  required
                />
              </label>
              <label>
                SN / Pernr *
                <input
                  value={techForm.sn}
                  onChange={(e) => setTechForm({ ...techForm, sn: e.target.value })}
                  required
                />
              </label>
              <p className="field-hint" style={{ marginTop: 0 }}>
                {t("tech.loginHint")}
              </p>
              <label>
                No. ID Badge *
                <input
                  value={techForm.badge_id}
                  onChange={(e) =>
                    setTechForm({ ...techForm, badge_id: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                Email *
                <input
                  type="email"
                  value={techForm.email}
                  onChange={(e) => setTechForm({ ...techForm, email: e.target.value })}
                  required
                />
              </label>
              <label>
                Telepon *
                <input
                  value={techForm.phone}
                  onChange={(e) => setTechForm({ ...techForm, phone: e.target.value })}
                  required
                />
              </label>
              <label>
                Superior
                <SearchableSelect
                  value={techForm.superior_user_id}
                  disabled={foremenLoading}
                  placeholder={
                    foremenLoading
                      ? "Memuat daftar foreman..."
                      : "Pilih foreman (opsional)"
                  }
                  emptyMessage="Tidak ada foreman yang cocok"
                  aria-label="Superior"
                  options={[
                    ...foremanPicker.map((u) => ({
                      value: u.id,
                      label: `${u.name || u.username}${
                        u.name && u.username && u.name !== u.username
                          ? ` — ${u.username}`
                          : ""
                      }`,
                      searchText: `${u.name} ${u.username}`,
                    })),
                    ...(techForm.superior_user_id &&
                    !foremanPicker.some((u) => u.id === techForm.superior_user_id) &&
                    modal.tech?.superior_user_id === techForm.superior_user_id
                      ? [
                          {
                            value: techForm.superior_user_id,
                            label:
                              modal.tech.superior_user_name ||
                              techForm.superior_user_id,
                            searchText: modal.tech.superior_user_name || "",
                          },
                        ]
                      : []),
                  ]}
                  onChange={(next) =>
                    setTechForm({ ...techForm, superior_user_id: next })
                  }
                />
              </label>
              {modal.tech?.status === "busy" ? (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                  Status: busy — tidak bisa diubah sampai job selesai.
                </p>
              ) : (
                <label>
                  Status *
                  <select
                    value={techForm.status}
                    onChange={(e) =>
                      setTechForm({
                        ...techForm,
                        status: e.target.value as Exclude<TechnicianStatus, "busy">,
                      })
                    }
                    required
                  >
                    <option value="available">available</option>
                    <option value="offline">offline</option>
                  </select>
                </label>
              )}
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "techs" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !techFormValid}
                  onClick={saveTech}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-tech" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "techs" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus teknisi</h3>
            {error && <div className="error">{error}</div>}
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.tech.name} — {modal.tech.sn}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus teknisi ini permanen? Jika masih terpasang di job aktif,
              penghapusan akan ditolak.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "techs" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteTech}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "users" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-users-title"
            onClick={(e) => e.stopPropagation()}
          >
            {(busy || usersLoading) && <BusyOverlay />}
            <div className="master-head">
              <h3 id="master-users-title">Master User</h3>
              <p className="master-lead">
                Kelola akun login (tersimpan di tabel <code>users</code>{" "}
                database).
              </p>
              {error && <div className="error">{error}</div>}
              <div
                className="panel-search-row"
                style={{ justifyContent: "stretch" }}
              >
                <input
                  className="panel-search"
                  style={{ maxWidth: "none" }}
                  type="search"
                  value={masterUserDraft}
                  onChange={(e) => setMasterUserDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyMasterUserSearch();
                    }
                  }}
                  placeholder="Cari username, nama, email, atau telp..."
                  aria-label="Cari user"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyMasterUserSearch}
                >
                  Cari
                </button>
                {masterUserQuery && (
                  <button
                    type="button"
                    className="btn"
                    onClick={clearMasterUserSearch}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="master-body">
              <div className="check-list">
                {appUsers.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>Belum ada user.</span>
                )}
                {appUsers.length > 0 && filteredMasterUsers.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    Tidak ada user yang cocok.
                  </span>
                )}
                {pagedMasterUsers.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px dashed var(--line-dashed)",
                    }}
                  >
                    <div>
                      <strong>{u.username}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {u.name || "—"}
                        {` · ${u.level}`}
                        {` · ${u.active === "1" ? "aktif" : "nonaktif"}`}
                      </div>
                      {(u.email || u.phone) && (
                        <div
                          style={{ color: "var(--muted)", fontSize: "0.85rem" }}
                        >
                          {[u.email, u.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canUserUpdate}
                        onClick={() => openUserEdit(u)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canUserDelete}
                        onClick={() =>
                          setModal({ type: "delete-user", user: u })
                        }
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {filteredMasterUsers.length > MASTER_PAGE_SIZE && (
                <Pager
                  page={masterUserPageSafe}
                  totalPages={masterUserTotalPages}
                  onChange={setMasterUserPage}
                />
              )}
            </div>
            <div className="master-foot actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canUserCreate}
                onClick={openUserCreate}
              >
                + User baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "user-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "users" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>{modal.mode === "create" ? "User baru" : "Edit user"}</h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Username *
                <input
                  value={userForm.username}
                  onChange={(e) =>
                    setUserForm({ ...userForm, username: e.target.value })
                  }
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Password {modal.mode === "create" ? "*" : "(kosongkan jika tidak diubah)"}
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm({ ...userForm, password: e.target.value })
                  }
                  autoComplete="new-password"
                  required={modal.mode === "create"}
                />
              </label>
              <label>
                Nama tampilan
                <input
                  value={userForm.name}
                  onChange={(e) =>
                    setUserForm({ ...userForm, name: e.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) =>
                    setUserForm({ ...userForm, email: e.target.value })
                  }
                  autoComplete="email"
                />
              </label>
              <label>
                No. Telp
                <input
                  type="tel"
                  value={userForm.phone}
                  onChange={(e) =>
                    setUserForm({ ...userForm, phone: e.target.value })
                  }
                  autoComplete="tel"
                />
              </label>
              <label>
                Level akses *
                <select
                  value={userForm.level}
                  onChange={(e) =>
                    setUserForm({
                      ...userForm,
                      level: e.target.value as UserLevel,
                    })
                  }
                  required
                >
                  {USER_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status *
                <select
                  value={userForm.active}
                  onChange={(e) =>
                    setUserForm({ ...userForm, active: e.target.value })
                  }
                  required
                >
                  <option value="1">aktif</option>
                  <option value="0">nonaktif</option>
                </select>
              </label>
              <div className="actions">
                <button className="btn" onClick={() => setModal({ type: "users" })}>
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !userFormValid}
                  onClick={saveUser}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-user" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "users" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus user</h3>
            {error && <div className="error">{error}</div>}
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.user.username}
              {modal.user.name ? ` — ${modal.user.name}` : ""}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus user ini permanen dari database? User aktif terakhir tidak
              bisa dihapus.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setModal({ type: "users" })}>
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteUser}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "attendance" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-attendance-title"
            onClick={(e) => e.stopPropagation()}
          >
            {busy && <BusyOverlay />}
            <div className="master-head">
              <h3 id="master-attendance-title">Daftar Hadir</h3>
              <p className="master-lead">
                Absensi / <strong>Meals Request</strong> dibanding master
                teknisi (No. ID Badge = SN). Ada di meals/hadir →{" "}
                <strong>available</strong>; tidak ada →{" "}
                <strong>offline</strong> (status busy tidak diubah).
              </p>
              {error && <div className="error">{error}</div>}
              {attendanceImportMsg && (
                <p style={{ color: "var(--green)", marginTop: 0 }}>
                  {attendanceImportMsg}
                </p>
              )}
              {(canAttendanceCreate || canTechUpdate) && (
                <details className="master-tools">
                  <summary>Upload / sync Meals</summary>
                  <div className="master-tools-body form">
                    {canAttendanceCreate && (
                      <>
                        <label>
                          Upload absensi Excel (.xlsx)
                          <input
                            type="file"
                            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) importAttendanceFile(file);
                            }}
                          />
                        </label>
                        <label className="check-item">
                          <input
                            type="checkbox"
                            checked={attendanceSyncTech}
                            disabled={!canTechUpdate}
                            onChange={(e) =>
                              setAttendanceSyncTech(e.target.checked)
                            }
                          />
                          <span>
                            Sync status teknisi (hadir → available; tidak hadir
                            / tidak di file → offline)
                          </span>
                        </label>
                      </>
                    )}
                    {canTechUpdate && (
                      <>
                        <div
                          className="actions"
                          style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}
                        >
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={() => void syncMealsPresence()}
                            title="Unduh Meals Request via Microsoft Graph lalu set available/offline"
                          >
                            Sync Meals SharePoint
                          </button>
                        </div>
                        <label>
                          Atau upload Meals Request (.xlsx) untuk presence
                          <input
                            type="file"
                            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) void syncMealsPresence({ file });
                            }}
                          />
                        </label>
                        <p
                          style={{
                            color: "var(--muted)",
                            fontSize: 12,
                            margin: 0,
                          }}
                        >
                          Graph: set AZURE_* + SHAREPOINT_MEALS_EXCEL_URL. Tanpa
                          Entra, unduh file / pakai Power Automate lalu upload
                          di sini.
                        </p>
                      </>
                    )}
                  </div>
                </details>
              )}
              <div
                className="panel-search-row"
                style={{ justifyContent: "stretch", flexWrap: "wrap" }}
              >
                <select
                  value={attendanceDateFilter}
                  onChange={(e) => setAttendanceDateFilter(e.target.value)}
                  style={{ maxWidth: 160 }}
                  aria-label="Filter tanggal"
                >
                  <option value="">Semua tanggal</option>
                  {attendanceDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  className="panel-search"
                  style={{ maxWidth: "none", flex: 1 }}
                  type="search"
                  value={attendanceDraft}
                  onChange={(e) => setAttendanceDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyAttendanceSearch();
                    }
                  }}
                  placeholder="Cari nama, Pernr, status..."
                  aria-label="Cari daftar hadir"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyAttendanceSearch}
                >
                  Cari
                </button>
                {(attendanceQuery || attendanceDateFilter) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      clearAttendanceSearch();
                      setAttendanceDateFilter("");
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="master-body">
              <div className="check-list">
                {(data?.attendance || []).length === 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    Belum ada data hadir. Upload Excel untuk mulai.
                  </span>
                )}
                {(data?.attendance || []).length > 0 &&
                  filteredAttendance.length === 0 && (
                    <span style={{ color: "var(--muted)" }}>
                      Tidak ada data yang cocok.
                    </span>
                  )}
                {pagedAttendance.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px dashed var(--line-dashed)",
                    }}
                  >
                    <div>
                      <strong>{a.technician_name}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                        {a.date}
                        {a.pernr ? ` · ${a.pernr}` : ""}
                        {` · ${a.status}`}
                        {a.dws ? ` · ${a.dws}` : ""}
                        {!a.technician_id ? " · belum match" : ""}
                      </div>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        className="btn"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canAttendanceUpdate}
                        onClick={() => openAttendanceEdit(a)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                        disabled={busy || !canAttendanceDelete}
                        onClick={() =>
                          setModal({ type: "delete-attendance", row: a })
                        }
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {filteredAttendance.length > MASTER_PAGE_SIZE && (
                <Pager
                  page={attendancePageSafe}
                  totalPages={attendanceTotalPages}
                  onChange={setAttendancePage}
                />
              )}
            </div>
            <div className="master-foot actions">
              <button className="btn" onClick={closeModal}>
                Tutup
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !canAttendanceCreate}
                onClick={openAttendanceCreate}
              >
                + Hadir baru
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "attendance-form" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "attendance" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menyimpan..." />}
            <h3>
              {modal.mode === "create" ? "Hadir baru" : "Edit daftar hadir"}
            </h3>
            {error && <div className="error">{error}</div>}
            <div className="form">
              <label>
                Tanggal *
                <input
                  type="date"
                  value={attendanceForm.date}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, date: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                Teknisi (opsional — auto isi nama/Pernr)
                <select
                  value={attendanceForm.technician_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const tech = attendanceTechnicians.find((t) => t.id === id);
                    setAttendanceForm({
                      ...attendanceForm,
                      technician_id: id,
                      technician_name: tech?.name || attendanceForm.technician_name,
                      pernr: tech?.sn || attendanceForm.pernr,
                    });
                  }}
                >
                  <option value="">— Pilih teknisi —</option>
                  {attendanceTechnicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.sn})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nama *
                <input
                  value={attendanceForm.technician_name}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      technician_name: e.target.value,
                    })
                  }
                  required
                />
              </label>
              <label>
                Pernr / SN
                <input
                  value={attendanceForm.pernr}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, pernr: e.target.value })
                  }
                />
              </label>
              <label>
                Status *
                <select
                  value={attendanceForm.status}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      status: e.target.value as AttendanceStatus,
                    })
                  }
                >
                  <option value="hadir">hadir</option>
                  <option value="izin">izin</option>
                  <option value="sakit">sakit</option>
                  <option value="off">off</option>
                  <option value="alpha">alpha</option>
                </select>
              </label>
              <label>
                DWS
                <input
                  value={attendanceForm.dws}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, dws: e.target.value })
                  }
                />
              </label>
              <label>
                Clock in
                <input
                  value={attendanceForm.check_in}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      check_in: e.target.value,
                    })
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label>
                Clock out
                <input
                  value={attendanceForm.check_out}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      check_out: e.target.value,
                    })
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label>
                Absence
                <input
                  value={attendanceForm.absence}
                  onChange={(e) =>
                    setAttendanceForm({
                      ...attendanceForm,
                      absence: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Catatan
                <input
                  value={attendanceForm.note}
                  onChange={(e) =>
                    setAttendanceForm({ ...attendanceForm, note: e.target.value })
                  }
                />
              </label>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => setModal({ type: "attendance" })}
                >
                  Kembali
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !attendanceForm.date ||
                    !attendanceForm.technician_name.trim()
                  }
                  onClick={saveAttendance}
                >
                  <BusyLabel busy={busy} idle="Simpan" pending="Menyimpan..." />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "delete-attendance" && (
        <div
          className="modal-backdrop"
          onClick={() => setModal({ type: "attendance" })}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {busy && <BusyOverlay label="Menghapus..." />}
            <h3>Hapus daftar hadir</h3>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              {modal.row.technician_name} — {modal.row.date}
              {modal.row.pernr ? ` · ${modal.row.pernr}` : ""}
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Hapus data hadir ini permanen?
            </p>
            <div className="actions">
              <button
                className="btn"
                onClick={() => setModal({ type: "attendance" })}
              >
                Kembali
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={confirmDeleteAttendance}
              >
                <BusyLabel busy={busy} idle="Ya, hapus" pending="Menghapus..." />
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "settings" && (
        <div className="modal-backdrop master-backdrop" onClick={closeModal}>
          <div
            className="modal master-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="master-head">
              <h3 id="master-settings-title">Settings</h3>
              <p className="master-lead">
                Sembunyikan panel di board. Preferensi tersimpan di browser ini.
              </p>
            </div>
            <div className="master-body">
              <div className="form">
                <label className="check-item" style={{ padding: "10px 0" }}>
                  <input
                    type="checkbox"
                    checked={hideTechPanel}
                    onChange={toggleHideTechPanel}
                  />
                  <span>
                    <strong>Sembunyikan panel Teknisi</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      Kolom available / busy / offline tidak ditampilkan
                    </div>
                  </span>
                </label>
                <label className="check-item" style={{ padding: "10px 0" }}>
                  <input
                    type="checkbox"
                    checked={hideJobPanel}
                    onChange={toggleHideJobPanel}
                  />
                  <span>
                    <strong>Sembunyikan panel Job</strong>
                    <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      Job aktif, antrian, dan riwayat tidak ditampilkan
                    </div>
                  </span>
                </label>
              </div>
            </div>
            <div className="master-foot actions">
              <button className="btn btn-primary" onClick={closeModal}>
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </>
  );
}
