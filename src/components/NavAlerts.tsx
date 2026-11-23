"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import { useNavAlerts } from "@/hooks/useNavAlerts";
import {
  EMPTY_NAV_ALERTS,
  navAlertTotal,
  type NavAlertItem,
} from "@/lib/nav-alerts";
import { NavHeaderPopBackdrop } from "@/components/NavHeaderPopBackdrop";
import { DsBadge } from "@/components/DsBadge";

type Props = {
  enabled: boolean;
  variant?: "bar" | "menu";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenJob: (jobId: string, kind?: NavAlertItem["kind"]) => void;
  onBeforeOpen?: () => void;
};

type FlyoutPos = { top: number; left: number; width: number };
type SectionTone = "handover" | "open" | "priority";

function placeAlertsFlyout(trigger: DOMRect): FlyoutPos {
  const margin = 16;
  const gap = 10;
  const width = Math.min(400, Math.max(300, window.innerWidth - margin * 2));
  const estHeight = Math.min(560, window.innerHeight - margin * 2);
  let left = trigger.right + gap;
  if (left + width > window.innerWidth - margin) {
    const flipLeft = trigger.left - gap - width;
    left =
      flipLeft >= margin
        ? flipLeft
        : Math.max(margin, window.innerWidth - margin - width);
  }
  let top = trigger.top;
  if (top + estHeight > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - margin - estHeight);
  }
  top = Math.min(Math.max(margin, top), window.innerHeight - margin - 64);
  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
  };
}

function AlertSection({
  title,
  count,
  items,
  empty,
  tone,
  openLabel,
  onPick,
}: {
  title: string;
  count: number;
  items: NavAlertItem[];
  empty: string;
  tone: SectionTone;
  openLabel: string;
  onPick: (item: NavAlertItem) => void;
}) {
  const hasItems = items.length > 0;
  return (
    <section
      className={`nav-alerts-section nav-alerts-section--${tone}${
        hasItems ? "" : " is-empty"
      }`}
    >
      <header className="nav-alerts-section-head">
        <h4>{title}</h4>
        <span
          className={`nav-alerts-count${count > 0 ? " is-active" : ""}`}
          aria-label={`${count}`}
        >
          {count}
        </span>
      </header>
      {hasItems ? (
        <ul className="nav-alerts-items">
          {items.map((item) => {
            const primary = item.unit
              ? `${item.unit} — ${item.title}`
              : item.title;
            const chips = [
              item.status && item.status !== item.subtitle
                ? item.status
                : null,
              item.priority &&
              item.kind !== "priority" &&
              item.priority !== item.subtitle
                ? item.priority
                : null,
            ].filter(Boolean) as string[];
            return (
              <li key={`${item.kind}-${item.jobId}-${item.subtitle}-${item.meta || ""}`}>
                <button
                  type="button"
                  className="nav-alerts-item"
                  onClick={() => onPick(item)}
                  title={openLabel}
                >
                  <span className="nav-alerts-item-main">
                    {item.unit ? (
                      <span className="nav-alerts-unit">{item.unit}</span>
                    ) : null}
                    <strong className="nav-alerts-item-title">
                      {item.unit ? item.title : primary}
                    </strong>
                  </span>
                  {item.subtitle ? (
                    <span className="nav-alerts-item-sub">{item.subtitle}</span>
                  ) : null}
                  {item.meta ? (
                    <span className="nav-alerts-item-meta">{item.meta}</span>
                  ) : null}
                  {chips.length ? (
                    <span className="nav-alerts-item-chips">
                      {chips.map((chip) => (
                        <span key={chip} className="nav-alerts-chip">
                          {chip}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="nav-alerts-item-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="nav-alerts-empty">{empty}</p>
      )}
    </section>
  );
}

export function NavAlerts({
  enabled,
  variant = "bar",
  open: openProp,
  onOpenChange,
  onOpenJob,
  onBeforeOpen,
}: Props) {
  const t = useT();
  const { data } = useNavAlerts(enabled);
  const [internalOpen, setInternalOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [useFlyout, setUseFlyout] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<FlyoutPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const payload = data || EMPTY_NAV_ALERTS;
  const total = navAlertTotal(payload);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  function setOpen(next: boolean) {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    function onPop(e: Event) {
      if ((e as CustomEvent<string>).detail === "alerts") return;
      setOpen(false);
    }
    window.addEventListener("prima-header-pop", onPop);
    return () => window.removeEventListener("prima-header-pop", onPop);
  }, [controlled]);

  useEffect(() => {
    if (!open || variant === "menu") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, variant, controlled]);

  useLayoutEffect(() => {
    if (!open || variant === "menu") {
      setFlyoutPos(null);
      return;
    }
    const narrow =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 720px)").matches;
    const inSidebar = Boolean(wrapRef.current?.closest(".app-sidebar"));
    const flyout = !narrow && inSidebar;
    setUseFlyout(flyout);
    if (!flyout) {
      setFlyoutPos(null);
      return;
    }
    function update() {
      const el = btnRef.current || wrapRef.current;
      if (!el) return;
      setFlyoutPos(placeAlertsFlyout(el.getBoundingClientRect()));
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, variant]);

  if (!enabled) return null;

  const pick = (item: NavAlertItem) => {
    setOpen(false);
    onOpenJob(item.jobId, item.kind);
  };

  const openLabel = t("nav.alertsOpenJob");

  const summary = (
    <header className="nav-alerts-summary">
      <div className="nav-alerts-summary-text">
        <p className="nav-alerts-summary-title">{t("nav.alerts")}</p>
        <p className="nav-alerts-summary-hint">{t("nav.alertsSummary")}</p>
      </div>
      <div className="nav-alerts-summary-stats" aria-label={t("nav.alertsTotal", { count: total })}>
        <span className={`nav-alerts-stat${payload.openHandovers ? " is-warn" : ""}`}>
          <em>{payload.openHandovers}</em>
          <small>HO</small>
        </span>
        <span className={`nav-alerts-stat${payload.openJobs ? " is-info" : ""}`}>
          <em>{payload.openJobs}</em>
          <small>Job</small>
        </span>
        <span className={`nav-alerts-stat${total ? " is-total" : ""}`}>
          <em>{total}</em>
          <small>All</small>
        </span>
      </div>
    </header>
  );

  const sections = (
    <>
      {summary}
      <AlertSection
        title={t("nav.alertsHandover")}
        count={payload.openHandovers}
        items={payload.items.handover}
        empty={t("nav.alertsHandoverEmpty")}
        tone="handover"
        openLabel={openLabel}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsOpenJobs")}
        count={payload.openJobs}
        items={payload.items.openJob}
        empty={t("nav.alertsOpenJobsEmpty")}
        tone="open"
        openLabel={openLabel}
        onPick={pick}
      />
      {(payload.priorityGroups?.length
        ? payload.priorityGroups
        : [
            {
              code: "URGENT",
              name: "URGENT",
              count: payload.urgentJobs,
              items: payload.items.urgent,
            },
            {
              code: "P1",
              name: "P1",
              count: payload.p1Jobs,
              items: payload.items.p1,
            },
            {
              code: "P2",
              name: "P2",
              count: payload.p2Jobs,
              items: payload.items.p2,
            },
            {
              code: "P3",
              name: "P3",
              count: payload.p3Jobs,
              items: payload.items.p3,
            },
          ]
      ).map((group) => (
        <AlertSection
          key={group.code}
          title={t("nav.alertsPriority", { name: group.name || group.code })}
          count={group.count}
          items={group.items}
          empty={t("nav.alertsPriorityEmpty", {
            name: group.name || group.code,
          })}
          tone="priority"
          openLabel={openLabel}
          onPick={pick}
        />
      ))}
    </>
  );

  if (variant === "menu") {
    return (
      <div className="nav-alerts nav-alerts--menu">
        <p className="nav-menu-label">{t("nav.alerts")}</p>
        <div className="nav-alerts-list" role="menu">
          {sections}
        </div>
      </div>
    );
  }

  const inlineList =
    open && !useFlyout ? (
      <div className="nav-alerts-list" role="menu">
        {sections}
      </div>
    ) : null;

  const flyoutList =
    open &&
    useFlyout &&
    portalReady &&
    flyoutPos &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="nav-alerts-list nav-alerts-list--flyout"
            role="menu"
            style={{
              top: flyoutPos.top,
              left: flyoutPos.left,
              width: flyoutPos.width,
            }}
          >
            {sections}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className={`nav-alerts${open ? " is-open" : ""}`}
      ref={wrapRef}
    >
      <NavHeaderPopBackdrop open={open} onClose={() => setOpen(false)} />
      <button
        ref={btnRef}
        className="btn btn-icon nav-alerts-btn"
        type="button"
        aria-label={t("nav.alerts")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("nav.alerts")}
        onClick={() => {
          onBeforeOpen?.();
          const next = !open;
          if (next) {
            window.dispatchEvent(
              new CustomEvent("prima-header-pop", { detail: "alerts" })
            );
          }
          setOpen(next);
        }}
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
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {total > 0 ? (
          <span className="nav-alerts-badge">
            <DsBadge color="critical" variant="count">
              {total}
            </DsBadge>
          </span>
        ) : null}
      </button>
      {inlineList}
      {flyoutList}
    </div>
  );
}
