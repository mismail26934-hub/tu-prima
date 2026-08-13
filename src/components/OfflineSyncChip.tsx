"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";

export function OfflineSyncChip({
  onRefresh,
  refreshBusy,
}: {
  onRefresh?: () => void;
  refreshBusy?: boolean;
}) {
  const t = useT();
  const { online, pending, syncing, error, retry } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = !online || pending > 0 || Boolean(error) || syncing;

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  if (!visible) return null;

  const tone = !online ? "offline" : error ? "error" : "sync";
  const chipLabel = !online
    ? pending > 0
      ? t("offline.chipOfflinePending", { count: pending })
      : t("offline.chipOffline")
    : syncing
      ? t("offline.chipSyncing", { count: pending })
      : t("offline.chipPending", { count: pending });

  const detail = !online
    ? pending > 0
      ? t("offline.bannerOfflinePending", { count: pending })
      : t("offline.bannerOffline")
    : syncing
      ? t("offline.bannerSyncing", { count: pending })
      : error
        ? t("offline.bannerError", { error })
        : t("offline.bannerPending", { count: pending });

  return (
    <div
      className={`offline-sync${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        className={`offline-sync-chip offline-sync-chip--${tone}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={detail}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="offline-sync-dot" aria-hidden="true" />
        {chipLabel}
      </button>
      {open ? (
        <div className="offline-sync-pop" role="dialog" aria-label={t("offline.popoverTitle")}>
          <p className="offline-sync-pop-title">{t("offline.popoverTitle")}</p>
          <p className="offline-sync-pop-body">{detail}</p>
          <div className="offline-sync-pop-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={syncing || !online || pending === 0}
              onClick={() => {
                retry();
              }}
            >
              {syncing ? t("offline.syncing") : t("offline.retry")}
            </button>
            <button
              className="btn"
              type="button"
              disabled={refreshBusy}
              onClick={() => {
                onRefresh?.();
                setOpen(false);
              }}
            >
              {t("nav.refresh")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
