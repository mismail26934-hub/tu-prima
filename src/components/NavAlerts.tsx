"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { useNavAlerts } from "@/hooks/useNavAlerts";
import {
  EMPTY_NAV_ALERTS,
  navAlertTotal,
  type NavAlertItem,
} from "@/lib/nav-alerts";

type Props = {
  enabled: boolean;
  variant?: "bar" | "menu";
  onOpenJob: (jobId: string, kind?: NavAlertItem["kind"]) => void;
  onBeforeOpen?: () => void;
};

function AlertSection({
  title,
  count,
  items,
  empty,
  onPick,
}: {
  title: string;
  count: number;
  items: NavAlertItem[];
  empty: string;
  onPick: (item: NavAlertItem) => void;
}) {
  return (
    <section className="nav-alerts-section">
      <h4>
        {title}
        <span>{count}</span>
      </h4>
      {items.length ? (
        items.map((item) => (
          <button
            key={`${item.kind}-${item.jobId}-${item.subtitle}`}
            type="button"
            className="nav-alerts-item"
            onClick={() => onPick(item)}
          >
            <strong>
              {item.unit ? `${item.unit} — ${item.title}` : item.title}
            </strong>
            {item.subtitle ? <span>{item.subtitle}</span> : null}
          </button>
        ))
      ) : (
        <p className="nav-alerts-empty">{empty}</p>
      )}
    </section>
  );
}

export function NavAlerts({
  enabled,
  variant = "bar",
  onOpenJob,
  onBeforeOpen,
}: Props) {
  const t = useT();
  const { data } = useNavAlerts(enabled);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const payload = data || EMPTY_NAV_ALERTS;
  const total = navAlertTotal(payload);

  useEffect(() => {
    if (!open || variant === "menu") return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  if (!enabled) return null;

  const pick = (item: NavAlertItem) => {
    setOpen(false);
    onOpenJob(item.jobId, item.kind);
  };

  const list = (
    <div className="nav-alerts-list" role="menu">
      <AlertSection
        title={t("nav.alertsHandover")}
        count={payload.openHandovers}
        items={payload.items.handover}
        empty={t("nav.alertsHandoverEmpty")}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsOpenJobs")}
        count={payload.openJobs}
        items={payload.items.openJob}
        empty={t("nav.alertsOpenJobsEmpty")}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsUrgent")}
        count={payload.urgentJobs}
        items={payload.items.urgent}
        empty={t("nav.alertsUrgentEmpty")}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsP1")}
        count={payload.p1Jobs}
        items={payload.items.p1}
        empty={t("nav.alertsP1Empty")}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsP2")}
        count={payload.p2Jobs}
        items={payload.items.p2}
        empty={t("nav.alertsP2Empty")}
        onPick={pick}
      />
      <AlertSection
        title={t("nav.alertsP3")}
        count={payload.p3Jobs}
        items={payload.items.p3}
        empty={t("nav.alertsP3Empty")}
        onPick={pick}
      />
    </div>
  );

  if (variant === "menu") {
    return (
      <div className="nav-alerts nav-alerts--menu">
        <p className="nav-menu-label">{t("nav.alerts")}</p>
        {list}
      </div>
    );
  }

  return (
    <div
      className={`nav-alerts${open ? " is-open" : ""}`}
      ref={wrapRef}
    >
      <button
        className="btn btn-icon nav-alerts-btn"
        type="button"
        aria-label={t("nav.alerts")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("nav.alerts")}
        onClick={() => {
          onBeforeOpen?.();
          setOpen((v) => !v);
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
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>
      {open ? list : null}
    </div>
  );
}
