'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n/useT';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { describeOutboxItems } from '@/lib/offline/outbox-label';
import { listOutbox, subscribeOutbox, type OutboxItem } from '@/lib/offline/outbox';

const MOBILE_MQ = '(max-width: 720px)';

type ChipTone = 'offline' | 'sync' | 'error';

function useMobileSheet() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

/** Rail-collapsed glyph — clearer than a bare status dot. */
function OfflineRailIcon({ tone }: { tone: ChipTone }) {
  if (tone === 'sync') {
    return (
      <svg
        className='offline-sync-icon'
        width='18'
        height='18'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' />
        <path d='M3 3v5h5' />
        <path d='M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' />
        <path d='M16 16h5v5' />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg
        className='offline-sync-icon'
        width='18'
        height='18'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <circle cx='12' cy='12' r='10' />
        <path d='M12 8v4' />
        <path d='M12 16h.01' />
      </svg>
    );
  }
  return (
    <svg
      className='offline-sync-icon'
      width='18'
      height='18'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M12 20h.01' />
      <path d='M8.5 16.429a5 5 0 0 1 7 0' />
      <path d='M5 12.859a10 10 0 0 1 5.17-2.69' />
      <path d='M19 12.859a10 10 0 0 0-2.007-1.523' />
      <path d='M2 8.82a15 15 0 0 1 4.177-2.318' />
      <path d='M22 8.82a15 15 0 0 0-11.288-3.764' />
      <path d='M1 1l22 22' />
    </svg>
  );
}

export function OfflineSyncChip({
  onRefresh,
  refreshBusy,
  railCompact = false,
}: {
  onRefresh?: () => void;
  refreshBusy?: boolean;
  /** Sidebar rail collapsed — icon-only chip + sheet panel. */
  railCompact?: boolean;
}) {
  const t = useT();
  const isMobile = useMobileSheet();
  /** Phone: bottom sheet. Tablet/desktop: centered dialog (avoids full-bleed stretch). */
  const panelMode = isMobile ? "sheet" : "dialog";
  const { online, pending, syncing, error, retry } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState<OutboxItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listOutbox().then((rows) => {
        if (!cancelled) setQueued(rows);
      });
    };
    load();
    const unsub = subscribeOutbox(load);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const visible = !online || pending > 0 || Boolean(error) || syncing;

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("offline-sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("offline-sheet-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!visible) return null;

  const tone: ChipTone = !online ? 'offline' : error ? 'error' : 'sync';
  const chipLabel = !online
    ? pending > 0
      ? t('offline.chipOfflinePending', { count: pending })
      : t('offline.chipOffline')
    : syncing
      ? t('offline.chipSyncing', { count: pending })
      : t('offline.chipPending', { count: pending });

  const detail = !online
    ? pending > 0
      ? t('offline.bannerOfflinePending', { count: pending })
      : t('offline.bannerOffline')
    : syncing
      ? t('offline.bannerSyncing', { count: pending })
      : error
        ? t('offline.bannerError', { error })
        : t('offline.bannerPending', { count: pending });

  const detailShort = !online
    ? pending > 0
      ? t('offline.bannerOfflinePendingShort', { count: pending })
      : t('offline.bannerOfflineShort')
    : syncing
      ? t('offline.bannerSyncing', { count: pending })
      : error
        ? t('offline.bannerError', { error })
        : t('offline.bannerPendingShort', { count: pending });

  const panelTitle = !online
    ? t('offline.sheetTitleOffline')
    : t('offline.popoverTitle');

  const canSync = online && pending > 0 && !syncing;
  const changes = describeOutboxItems(queued, t);

  const panelBody = (
    <>
      <div className='offline-sync-panel-head'>
        <p className='offline-sync-pop-title'>{panelTitle}</p>
        <button
          type='button'
          className='btn btn-icon offline-sync-sheet-close'
          aria-label={t('offline.close')}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </div>
      <p className='offline-sync-pop-body'>{detailShort}</p>
      {changes.length > 0 ? (
        <>
          <p className='offline-sync-changes-label'>{t('offline.pendingList')}</p>
          <ul className='offline-sync-changes'>
            {changes.map((row) => (
              <li
                key={row.id}
                className={`offline-sync-change${
                  row.status === 'error' ? ' is-error' : ''
                }`}
              >
                <p className='offline-sync-change-title'>{row.title}</p>
                {row.meta ? (
                  <p className='offline-sync-change-meta'>{row.meta}</p>
                ) : null}
                {row.error ? (
                  <p className='offline-sync-change-meta'>{row.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="offline-sync-pop-actions offline-sync-pop-actions--stack">
        {!online ? (
          <p className="offline-sync-pop-status" role="status">
            {pending > 0
              ? t("offline.waitingConnectionPending", { count: pending })
              : t("offline.waitingConnection")}
          </p>
        ) : (
          <div className="offline-sync-pop-actions-row">
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
          </div>
        )}
        <button
          className="btn offline-sync-btn offline-sync-btn--close"
          type="button"
          onClick={() => setOpen(false)}
        >
          {t("offline.close")}
        </button>
      </div>
    </>
  );

  return (
    <div
      className={`offline-sync${open ? ' is-open' : ''}${
        railCompact ? ' offline-sync--rail' : ''
      }`}
      ref={rootRef}
    >
      <button
        className={`offline-sync-chip offline-sync-chip--${tone}`}
        type='button'
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-label={chipLabel}
        data-rail-tip={chipLabel}
        title={detail}
        onClick={() => setOpen((v) => !v)}
      >
        {railCompact ? (
          <OfflineRailIcon tone={tone} />
        ) : (
          <span className='offline-sync-dot' aria-hidden='true' />
        )}
        <span className='offline-sync-label'>{chipLabel}</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className={
                panelMode === "sheet"
                  ? "offline-sync-sheet-backdrop"
                  : "offline-sync-dialog-backdrop"
              }
              onClick={() => setOpen(false)}
            >
              <div
                className={
                  panelMode === "sheet"
                    ? "offline-sync-sheet"
                    : "offline-sync-dialog"
                }
                role="dialog"
                aria-modal="true"
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
