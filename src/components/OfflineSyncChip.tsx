"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";

const MOBILE_MQ = "(max-width: 720px)";

function useMobileSheet() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function OfflineSyncChip({
  onRefresh,
  refreshBusy,
}: {
  onRefresh?: () => void;
  refreshBusy?: boolean;
}) {
  const t = useT();
  const isMobile = useMobileSheet();
  const { online, pending, syncing, error, retry } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = !online || pending > 0 || Boolean(error) || syncing;

  useEffect(() => {
    if (!open || isMobile) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, isMobile]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open || !isMobile) return;
    document.documentElement.classList.add("offline-sheet-open");
    return () => document.documentElement.classList.remove("offline-sheet-open");
  }, [open, isMobile]);

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

  const detailShort = !online
    ? pending > 0
      ? t("offline.bannerOfflinePendingShort", { count: pending })
      : t("offline.bannerOfflineShort")
    : syncing
      ? t("offline.bannerSyncing", { count: pending })
      : error
        ? t("offline.bannerError", { error })
        : t("offline.bannerPendingShort", { count: pending });

  const panelTitle = !online
    ? t("offline.sheetTitleOffline")
    : t("offline.popoverTitle");

  const canSync = online && pending > 0 && !syncing;

  const panelBody = (
    <>
      <div className="offline-sync-panel-head">
        <p className="offline-sync-pop-title">{panelTitle}</p>
        <button
          type="button"
          className="btn btn-icon offline-sync-sheet-close"
          aria-label={t("offline.close")}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </div>
      <p className="offline-sync-pop-body">{detailShort}</p>
      <div
        className={`offline-sync-pop-actions${
          isMobile ? " offline-sync-pop-actions--stack" : ""
        }`}
      >
        {!online ? (
          <p className="offline-sync-pop-status" role="status">
            {pending > 0
              ? t("offline.waitingConnectionPending", { count: pending })
              : t("offline.waitingConnection")}
          </p>
        ) : (
          <>
            <button
              className="btn btn-primary offline-sync-btn"
              type="button"
              disabled={!canSync}
              onClick={() => {
                retry();
              }}
            >
              {syncing ? t("offline.syncing") : t("offline.retry")}
            </button>
            <button
              className="btn offline-sync-btn"
              type="button"
              disabled={refreshBusy}
              onClick={() => {
                onRefresh?.();
                setOpen(false);
              }}
            >
              {t("nav.refresh")}
            </button>
          </>
        )}
        {isMobile ? (
          <button
            className="btn offline-sync-btn"
            type="button"
            onClick={() => setOpen(false)}
          >
            {t("offline.close")}
          </button>
        ) : null}
      </div>
    </>
  );

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
      {open && !isMobile ? (
        <div className="offline-sync-pop" role="dialog" aria-label={panelTitle}>
          {panelBody}
        </div>
      ) : null}
      {open && isMobile && typeof document !== "undefined"
        ? createPortal(
            <div
              className="offline-sync-sheet-backdrop"
              onClick={() => setOpen(false)}
            >
              <div
                className="offline-sync-sheet"
                role="dialog"
                aria-label={panelTitle}
                onClick={(e) => e.stopPropagation()}
              >
                {panelBody}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
