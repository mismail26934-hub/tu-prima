'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { LanguageToggle } from '@/components/LanguageToggle';
import { NavAlerts } from '@/components/NavAlerts';
import { NavHeaderPopBackdrop } from '@/components/NavHeaderPopBackdrop';
import { OfflineSyncChip } from '@/components/OfflineSyncChip';
import { RemainAlertMuteToggle } from '@/components/RemainAlertMuteToggle';
import { useT } from '@/i18n/useT';
import type { NavAlertKind } from '@/lib/nav-alerts';
import type { UserLevel } from '@/lib/types';

type BoardTopbarProps = {
  busy: boolean;
  loggingOut: boolean;
  theme: 'light' | 'dark';
  isLoggedIn: boolean;
  sessionPending: boolean;
  /** Full navbar action shimmer on page refresh (logo stays visible). */
  refreshShimmer?: boolean;
  sessionShimmerWithAlerts: boolean;
  showNavAlerts: boolean;
  userLevel: UserLevel | string;
  displayName: string;
  avatarUrl: string;
  canUnitRead: boolean;
  canCustomerRead: boolean;
  canShiftRead: boolean;
  canPriorityRead: boolean;
  canTemplateRead: boolean;
  modalOpen: boolean;
  /** Sidebar item for the screen that is open now. */
  activeNav?: string | null;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onSettings: () => void;
  onTechnicians: () => void;
  onUsersMaster: () => void;
  onUnitsMaster: () => void;
  onCustomersMaster: () => void;
  onShiftsMaster: () => void;
  onPrioritiesMaster: () => void;
  onTemplatesMaster: () => void;
  onAttendance: () => void;
  onExportExcel: () => void;
  onHandoverForm: () => void;
  onJobBackups: () => void;
  onEditProfile: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onOpenJob: (jobId: string, kind?: NavAlertKind) => void;
};

function ShimmerBlock({ className = '' }: { className?: string }) {
  return (
    <span className={`shimmer-block ${className}`.trim()} aria-hidden='true' />
  );
}

function NavAccountShimmer({
  label,
  withAlerts = true,
}: {
  label: string;
  withAlerts?: boolean;
}) {
  return (
    <div
      className='nav-session-shimmer'
      role='status'
      aria-live='polite'
      aria-busy='true'
    >
      <span className='sr-only'>{label}</span>
      {withAlerts ? (
        <>
          <ShimmerBlock className='shimmer-block--nav-icon' />
          <ShimmerBlock className='shimmer-block--nav-icon' />
        </>
      ) : null}
      <span className='nav-account-shimmer' aria-hidden='true'>
        <span className='nav-user'>
          <ShimmerBlock className='shimmer-block--nav-name' />
          <ShimmerBlock className='shimmer-block--nav-level' />
        </span>
        <ShimmerBlock className='shimmer-block--nav-avatar' />
      </span>
    </div>
  );
}

function NavBarRefreshShimmer({ label }: { label: string }) {
  return (
    <div
      className='nav-refresh-shimmer'
      role='status'
      aria-live='polite'
      aria-busy='true'
    >
      <span className='sr-only'>{label}</span>
      <div className='nav-refresh-shimmer-bar' aria-hidden='true'>
        <ShimmerBlock className='shimmer-block--nav-btn shimmer-block--nav-btn-wide' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-btn' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-account' />
      </div>
      <div className='nav-refresh-shimmer-mobile' aria-hidden='true'>
        <ShimmerBlock className='shimmer-block--nav-btn' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
        <ShimmerBlock className='shimmer-block--nav-icon' />
      </div>
    </div>
  );
}

function AccountAvatar({ url, size = 28 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (!url || failed) {
    return (
      <span className='nav-avatar nav-avatar-fallback' aria-hidden='true'>
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 32 32'
          fill='none'
        >
          <circle cx='16' cy='16' r='16' fill='white' />
        </svg>
      </span>
    );
  }
  return (
    <img
      className='nav-avatar'
      src={url}
      alt=''
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}

function SunIcon() {
  return (
    <svg
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
      <circle cx='12' cy='12' r='4' />
      <path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
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
      <path d='M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z' />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
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
      <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
      <path d='M16 17l5-5-5-5' />
      <path d='M21 12H9' />
    </svg>
  );
}

function ManageItemIcon({
  name,
}: {
  name:
    | 'settings'
    | 'techs'
    | 'users'
    | 'units'
    | 'customers'
    | 'shifts'
    | 'priorities'
    | 'templates'
    | 'attendance'
    | 'export'
    | 'handoverForm'
    | 'backup';
}) {
  return (
    <svg
      className='nav-manage-item-icon'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {name === 'settings' && (
        <>
          <circle cx='12' cy='12' r='3' />
          <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
        </>
      )}
      {name === 'techs' && (
        <>
          <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
          <circle cx='9' cy='7' r='4' />
          <path d='M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' />
        </>
      )}
      {name === 'users' && (
        <>
          <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
          <circle cx='12' cy='7' r='4' />
        </>
      )}
      {name === 'units' && (
        <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
      )}
      {name === 'customers' && (
        <>
          <path d='M3 21h18' />
          <path d='M5 21V7l7-4 7 4v14' />
          <path d='M9 21v-6h6v6' />
        </>
      )}
      {name === 'shifts' && (
        <>
          <circle cx='12' cy='12' r='9' />
          <path d='M12 7v5l3 2' />
        </>
      )}
      {name === 'priorities' && (
        <>
          <path d='M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' />
          <path d='M4 22V15' />
        </>
      )}
      {name === 'templates' && (
        <>
          <path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' />
          <rect x='8' y='2' width='8' height='4' rx='1' />
          <path d='M8 12h8M8 16h5' />
        </>
      )}
      {name === 'attendance' && (
        <>
          <rect x='3' y='4' width='18' height='18' rx='2' />
          <path d='M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4' />
        </>
      )}
      {name === 'export' && (
        <>
          <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
          <path d='M7 10l5 5 5-5M12 15V3' />
        </>
      )}
      {name === 'handoverForm' && (
        <>
          <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
          <path d='M14 2v6h6M8 13h8M8 17h6' />
        </>
      )}
      {name === 'backup' && (
        <>
          <path d='M3 12a9 9 0 1 0 3-6.7' />
          <path d='M3 4v5h5' />
        </>
      )}
    </svg>
  );
}

/** Kelola — hard hat + caret, matching the collapsed rail. */
function ManageIcon() {
  return (
    <svg
      className='nav-manage-icon'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M10 10V6.5a2 2 0 0 1 4 0V10' />
      <path d='M4 15.5v-2a8 8 0 0 1 16 0v2' />
      <path d='M2 18.5a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z' />
    </svg>
  );
}

function MenuIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className='sidebar-menu-icon'
      src='/sidebar-menu.svg'
      width={20}
      height={20}
      alt=''
    />
  );
}

/** Place the account portal menu beside the trigger, clamped inside the viewport. */
function placeAccountMenu(trigger: DOMRect): {
  top: number;
  left: number;
  width: number;
} {
  const margin = 16;
  const gap = 10;
  const width = Math.min(264, Math.max(200, window.innerWidth - margin * 2));
  const estHeight = 300;
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

export function BoardTopbar({
  busy,
  loggingOut,
  theme,
  isLoggedIn,
  sessionPending,
  refreshShimmer = false,
  sessionShimmerWithAlerts,
  showNavAlerts,
  userLevel,
  displayName,
  avatarUrl,
  canUnitRead,
  canCustomerRead,
  canShiftRead,
  canPriorityRead,
  canTemplateRead,
  modalOpen,
  activeNav = null,
  onRefresh,
  onToggleTheme,
  onSettings,
  onTechnicians,
  onUsersMaster,
  onUnitsMaster,
  onCustomersMaster,
  onShiftsMaster,
  onPrioritiesMaster,
  onTemplatesMaster,
  onAttendance,
  onExportExcel,
  onHandoverForm,
  onJobBackups,
  onEditProfile,
  onChangePassword,
  onLogout,
  onLogin,
  onOpenJob,
}: BoardTopbarProps) {
  const t = useT();
  const topbarRef = useRef<HTMLElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const railTipRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionMenuPos, setSessionMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [sheetAccountOpen, setSheetAccountOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    let lastHeight = -1;
    const sync = () => {
      // Vertical sidebar is 100dvh — measure the head row only so slider/modals
      // don't get padding ≈ viewport height (blank crushed content).
      const isSidebar = el.classList.contains('app-sidebar');
      const head = isSidebar
        ? el.querySelector<HTMLElement>('.app-sidebar-head')
        : null;
      const measureEl = head ?? el;
      const box = measureEl.getBoundingClientRect();
      const height = Math.ceil(box.height);
      const bottom = Math.ceil(box.bottom);
      const scrollY =
        window.scrollY ??
        document.documentElement.scrollTop ??
        document.body.scrollTop ??
        0;
      const isScrolled = scrollY > 4;
      el.classList.toggle('is-scrolled', isScrolled);
      document.documentElement.classList.toggle('topbar-scrolled', isScrolled);
      setScrolled(isScrolled);
      if (height !== lastHeight) {
        lastHeight = height;
        document.documentElement.style.setProperty(
          '--topbar-height',
          `${height}px`
        );
      }
      document.documentElement.style.setProperty(
        '--topbar-offset',
        `${bottom + 8}px`
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const headEl = el.querySelector<HTMLElement>('.app-sidebar-head');
    if (headEl) ro.observe(headEl);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      document.documentElement.classList.remove('topbar-scrolled');
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const tip = railTipRef.current;
    if (tip) tip.hidden = true;
  }, [sidebarOpen]);

  useEffect(() => {
    if (!manageOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setManageOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [manageOpen]);

  useEffect(() => {
    if (!sessionOpen || mobileMenuOpen) {
      setSessionMenuPos(null);
      return;
    }
    function syncPos() {
      const el = sessionRef.current;
      if (!el) return;
      setSessionMenuPos(placeAccountMenu(el.getBoundingClientRect()));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSessionOpen(false);
    }
    syncPos();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', syncPos);
    window.addEventListener('scroll', syncPos, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', syncPos);
      window.removeEventListener('scroll', syncPos);
    };
  }, [sessionOpen, mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      setManageOpen(false);
      setSessionOpen(false);
    } else {
      setSheetAccountOpen(false);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    setSessionOpen(false);
    setMobileMenuOpen(false);
    setSidebarOpen(false);
    setManageOpen(Boolean(activeNav && activeNav !== 'new-job'));
  }, [modalOpen, activeNav]);

  useEffect(() => {
    if (!refreshShimmer) return;
    setManageOpen(false);
    setSessionOpen(false);
    setMobileMenuOpen(false);
    setSheetAccountOpen(false);
  }, [refreshShimmer]);

  useEffect(() => {
    function onPop(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      // Sound / alerts open their own dialogs; keep the account menu mounted
      // so RemainAlertMuteToggle is not torn down before its modal paints.
      if (detail === 'sound' || detail === 'alerts') return;
      if (detail === 'manage') {
        setSessionOpen(false);
        return;
      }
      if (detail === 'session') {
        setManageOpen(false);
        return;
      }
      setManageOpen(false);
      setSessionOpen(false);
    }
    window.addEventListener('prima-header-pop', onPop);
    return () => window.removeEventListener('prima-header-pop', onPop);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', mobileMenuOpen);
    if (mobileMenuOpen && topbarRef.current) {
      const bottom = Math.ceil(
        topbarRef.current.getBoundingClientRect().bottom
      );
      document.documentElement.style.setProperty(
        '--topbar-offset',
        `${bottom + 8}px`
      );
    }
    return () => {
      document.documentElement.classList.remove('menu-open');
    };
  }, [mobileMenuOpen]);

  function hideRailTip() {
    const tip = railTipRef.current;
    if (tip) tip.hidden = true;
    topbarRef.current
      ?.querySelectorAll<HTMLElement>('[data-saved-title]')
      .forEach((el) => {
        const saved = el.dataset.savedTitle;
        if (saved) el.setAttribute('title', saved);
        delete el.dataset.savedTitle;
      });
  }

  function showRailTip(target: EventTarget | null) {
    const header = topbarRef.current;
    const tip = railTipRef.current;
    if (!header || !tip || sidebarOpen) {
      hideRailTip();
      return;
    }
    const el = target instanceof Element ? target : null;
    const btn = el?.closest<HTMLElement>(
      '.app-sidebar-toggle, .nav-account, .nav-manage > .btn, .nav-manage-item, .top-actions-panel--bar > .btn, .lang-toggle-icon, .nav-alerts-btn, .remain-alert-mute, .offline-sync-chip'
    );
    if (!btn || !header.contains(btn)) {
      hideRailTip();
      return;
    }
    const text =
      btn.getAttribute('data-rail-tip') ||
      btn.getAttribute('title') ||
      btn.dataset.savedTitle ||
      btn.getAttribute('aria-label') ||
      '';
    if (!text) {
      hideRailTip();
      return;
    }
    header.querySelectorAll<HTMLElement>('[data-saved-title]').forEach((el) => {
      if (el === btn) return;
      const saved = el.dataset.savedTitle;
      if (saved) el.setAttribute('title', saved);
      delete el.dataset.savedTitle;
    });
    const saved = btn.getAttribute('title');
    if (saved) {
      btn.dataset.savedTitle = saved;
      btn.removeAttribute('title');
    }
    const box = btn.getBoundingClientRect();
    tip.textContent = text;
    tip.style.top = `${Math.round(box.top + box.height / 2)}px`;
    tip.style.left = `${Math.round(box.right + 12)}px`;
    tip.hidden = false;
  }

  function closeMenu(keepManage = false) {
    setMobileMenuOpen(false);
    setSessionOpen(false);
    setSheetAccountOpen(false);
    if (!keepManage) setManageOpen(false);
  }

  function manageItemClass(key: string) {
    return `nav-manage-item${activeNav === key ? ' is-active' : ''}`;
  }

  const manageItems = (
    <>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('settings')}
        disabled={busy}
        title={t('nav.settings')}
        aria-current={activeNav === 'settings' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onSettings();
        }}
      >
        <ManageItemIcon name='settings' />
        {t('nav.settings')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('techs')}
        disabled={busy}
        title={t('nav.technicians')}
        aria-current={activeNav === 'techs' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onTechnicians();
        }}
      >
        <ManageItemIcon name='techs' />
        {t('nav.technicians')}
      </button>
      {userLevel === 'superuser' && (
        <button
          type='button'
          role='menuitem'
          className={manageItemClass('users')}
          disabled={busy}
          title={t('nav.usersMaster')}
          aria-current={activeNav === 'users' ? 'page' : undefined}
          onClick={() => {
            closeMenu(true);
            onUsersMaster();
          }}
        >
          <ManageItemIcon name='users' />
          {t('nav.usersMaster')}
        </button>
      )}
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('units')}
        disabled={busy || !canUnitRead}
        title={t('nav.unitsMaster')}
        aria-current={activeNav === 'units' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onUnitsMaster();
        }}
      >
        <ManageItemIcon name='units' />
        {t('nav.unitsMaster')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('customers')}
        disabled={busy || !canCustomerRead}
        title={t('nav.customersMaster')}
        aria-current={activeNav === 'customers' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onCustomersMaster();
        }}
      >
        <ManageItemIcon name='customers' />
        {t('nav.customersMaster')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('shifts')}
        disabled={busy || !canShiftRead}
        title={t('nav.shiftsMaster')}
        aria-current={activeNav === 'shifts' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onShiftsMaster();
        }}
      >
        <ManageItemIcon name='shifts' />
        {t('nav.shiftsMaster')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('priorities')}
        disabled={busy || !canPriorityRead}
        title={t('nav.prioritiesMaster')}
        aria-current={activeNav === 'priorities' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onPrioritiesMaster();
        }}
      >
        <ManageItemIcon name='priorities' />
        {t('nav.prioritiesMaster')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('templates')}
        disabled={busy || !canTemplateRead}
        title={t('nav.templatesMaster')}
        aria-current={activeNav === 'templates' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onTemplatesMaster();
        }}
      >
        <ManageItemIcon name='templates' />
        {t('nav.templatesMaster')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('attendance')}
        disabled={busy}
        title={t('nav.attendance')}
        aria-current={activeNav === 'attendance' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onAttendance();
        }}
      >
        <ManageItemIcon name='attendance' />
        {t('nav.attendance')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('export')}
        disabled={busy || !isLoggedIn}
        title={isLoggedIn ? t('nav.exportExcelTip') : t('nav.exportNeedLogin')}
        aria-current={activeNav === 'export' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onExportExcel();
        }}
      >
        <ManageItemIcon name='export' />
        {t('nav.exportExcel')}
      </button>
      <button
        type='button'
        role='menuitem'
        className={manageItemClass('handoverForm')}
        disabled={busy || !isLoggedIn}
        title={isLoggedIn ? t('nav.handoverFormTip') : t('nav.exportNeedLogin')}
        aria-current={activeNav === 'handoverForm' ? 'page' : undefined}
        onClick={() => {
          closeMenu(true);
          onHandoverForm();
        }}
      >
        <ManageItemIcon name='handoverForm' />
        {t('nav.handoverForm')}
      </button>
      {userLevel === 'superuser' && (
        <button
          type='button'
          role='menuitem'
          className={manageItemClass('backup')}
          disabled={busy}
          title='Riwayat backup perubahan job (undo)'
          aria-current={activeNav === 'backup' ? 'page' : undefined}
          onClick={() => {
            closeMenu(true);
            onJobBackups();
          }}
        >
          <ManageItemIcon name='backup' />
          {t('nav.backupUndo')}
        </button>
      )}
    </>
  );

  return (
    <>
      {/* Sibling glass layer (same as tu-rental/ARMOR) — sticky topbar owns blur when framed */}
      <div
        className={`topbar-glass${scrolled ? ' is-scrolled' : ''}`}
        aria-hidden='true'
      />
      <NavHeaderPopBackdrop
        open={sessionOpen}
        onClose={() => {
          setSessionOpen(false);
        }}
      />
      {sidebarOpen ? (
        <button
          type='button'
          className='app-sidebar-backdrop'
          aria-label={t('nav.closeMenu')}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <header
        className={`topbar app-sidebar${sidebarOpen ? ' is-open' : ''}${scrolled ? ' is-scrolled' : ''}`}
        ref={topbarRef}
        onMouseOver={(e) => showRailTip(e.target)}
        onMouseOut={(e) => {
          const next = e.relatedTarget;
          if (next instanceof Node && topbarRef.current?.contains(next)) return;
          hideRailTip();
        }}
      >
        <div className='app-sidebar-head'>
          <button
            type='button'
            className='app-sidebar-toggle'
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
          <Link className='brand-lockup' href='/' aria-label={t('app.title')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className='brand-mark'
              src='/trakindo-cat.svg'
              width={115}
              height={29}
              alt=''
            />
          </Link>
        </div>
        <div className='brand-row'>
          {refreshShimmer ? (
            <ShimmerBlock className='shimmer-block--nav-sync' />
          ) : (
            <OfflineSyncChip
              onRefresh={onRefresh}
              refreshBusy={busy}
              railCompact={!sidebarOpen}
            />
          )}
        </div>
        <div className='top-actions'>
          {refreshShimmer ? (
            <NavBarRefreshShimmer label={t('loading.dashboard')} />
          ) : (
            <>
              <div className='top-actions-panel top-actions-panel--bar'>
                {sessionPending ? (
                  <NavAccountShimmer
                    label={t('nav.accountLoading')}
                    withAlerts={false}
                  />
                ) : (
                  <div className='nav-session'>
                    {isLoggedIn ? (
                      <div
                        className={`nav-session-menu${sessionOpen ? ' is-open' : ''}`}
                        ref={sessionRef}
                      >
                        <button
                          className='btn nav-account'
                          type='button'
                          disabled={busy || loggingOut}
                          aria-label={t('nav.accountMenu')}
                          aria-haspopup='menu'
                          aria-expanded={sessionOpen}
                          title={`${displayName} · ${userLevel}`}
                          onClick={() => {
                            setManageOpen(false);
                            const next = !sessionOpen;
                            if (next) {
                              window.dispatchEvent(
                                new CustomEvent('prima-header-pop', {
                                  detail: 'session',
                                })
                              );
                              const el = sessionRef.current;
                              if (el) {
                                setSessionMenuPos(
                                  placeAccountMenu(el.getBoundingClientRect())
                                );
                              }
                            } else {
                              setSessionMenuPos(null);
                            }
                            setSessionOpen(next);
                          }}
                        >
                          <AccountAvatar url={avatarUrl} size={32} />
                          <span className='nav-user'>
                            <span className='nav-user-name'>{displayName}</span>
                          </span>
                        </button>
                        {sessionOpen &&
                          portalReady &&
                          sessionMenuPos &&
                          createPortal(
                            <div
                              className='nav-manage-menu nav-session-portal-menu'
                              role='menu'
                              style={{
                                top: sessionMenuPos.top,
                                left: sessionMenuPos.left,
                                width: sessionMenuPos.width,
                              }}
                            >
                              <button
                                type='button'
                                role='menuitem'
                                className='nav-manage-item'
                                disabled={busy || loggingOut}
                                onClick={() => {
                                  closeMenu();
                                  void onEditProfile();
                                }}
                              >
                                {t('nav.editProfile')}
                              </button>
                              <button
                                type='button'
                                role='menuitem'
                                className='nav-manage-item'
                                disabled={busy || loggingOut}
                                onClick={() => {
                                  closeMenu();
                                  onChangePassword();
                                }}
                              >
                                {t('nav.editPassword')}
                              </button>
                              <p
                                className='nav-session-group-label'
                                role='presentation'
                              >
                                {t('nav.settings')}
                              </p>
                              <div
                                className='nav-session-prefs'
                                role='group'
                                aria-label={t('nav.settings')}
                              >
                                <LanguageToggle />
                                <button
                                  className='btn btn-icon'
                                  type='button'
                                  onClick={onToggleTheme}
                                  aria-label={
                                    theme === 'dark'
                                      ? t('nav.lightMode')
                                      : t('nav.darkMode')
                                  }
                                  title={
                                    theme === 'dark'
                                      ? t('nav.lightMode')
                                      : t('nav.darkMode')
                                  }
                                >
                                  {theme === 'dark' ? (
                                    <SunIcon />
                                  ) : (
                                    <MoonIcon />
                                  )}
                                </button>
                                <RemainAlertMuteToggle
                                  variant='menu'
                                  onBeforeOpen={() => {
                                    setManageOpen(false);
                                  }}
                                />
                              </div>
                              <button
                                type='button'
                                role='menuitem'
                                className='nav-manage-item'
                                disabled={busy || loggingOut}
                                onClick={() => {
                                  closeMenu();
                                  onLogout();
                                }}
                              >
                                {t('nav.logout')}
                              </button>
                            </div>,
                            document.body
                          )}
                      </div>
                    ) : (
                      <button
                        className='btn'
                        disabled={busy || loggingOut}
                        onClick={onLogin}
                      >
                        {t('nav.login')}
                      </button>
                    )}
                  </div>
                )}
                <div
                  className={`nav-manage${manageOpen ? ' is-open' : ''}`}
                >
                  <button
                    className='btn'
                    type='button'
                    disabled={busy}
                    aria-label={t('nav.manage')}
                    title={t('nav.manage')}
                    aria-haspopup='menu'
                    aria-expanded={manageOpen}
                    onClick={() => {
                      setSessionOpen(false);
                      setManageOpen((open) => !open);
                    }}
                  >
                    <ManageIcon />
                    <svg
                      className='nav-manage-caret'
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2.5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <path d='M6 9l6 6 6-6' />
                    </svg>
                    <span className='btn-label'>{t('nav.manage')}</span>
                  </button>
                  {manageOpen && (
                    <div className='nav-manage-menu' role='menu'>
                      {manageItems}
                    </div>
                  )}
                </div>
                {!isLoggedIn && !sessionPending ? (
                  <>
                    <LanguageToggle />
                    <button
                      className='btn btn-icon'
                      type='button'
                      onClick={onToggleTheme}
                      aria-label={
                        theme === 'dark'
                          ? t('nav.lightMode')
                          : t('nav.darkMode')
                      }
                      title={
                        theme === 'dark'
                          ? t('nav.lightMode')
                          : t('nav.darkMode')
                      }
                    >
                      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                    </button>
                  </>
                ) : null}
                <div className='nav-end'>
                  {sessionPending ? (
                    sessionShimmerWithAlerts ? (
                      <ShimmerBlock className='shimmer-block--nav-icon' />
                    ) : null
                  ) : (
                    <NavAlerts
                      enabled={showNavAlerts}
                      onBeforeOpen={() => {
                        setManageOpen(false);
                        setSessionOpen(false);
                      }}
                      onOpenJob={(jobId, kind) => {
                        setManageOpen(false);
                        setSessionOpen(false);
                        onOpenJob(jobId, kind);
                      }}
                    />
                  )}
                </div>
              </div>

              <div className='top-actions-mobile'>
                {sessionPending ? (
                  sessionShimmerWithAlerts ? (
                    <ShimmerBlock className='shimmer-block--nav-icon' />
                  ) : null
                ) : (
                  <NavAlerts
                    enabled={showNavAlerts}
                    onBeforeOpen={() => {
                      setSessionOpen(false);
                      setMobileMenuOpen(false);
                    }}
                    onOpenJob={(jobId, kind) => {
                      setMobileMenuOpen(false);
                      onOpenJob(jobId, kind);
                    }}
                  />
                )}
                <button
                  className='btn btn-icon top-menu-toggle'
                  type='button'
                  aria-label={
                    mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')
                  }
                  aria-expanded={mobileMenuOpen}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('prima-header-pop', { detail: 'menu' })
                    );
                    setMobileMenuOpen((o) => !o);
                  }}
                >
                  {mobileMenuOpen ? (
                    <svg
                      width='18'
                      height='18'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      aria-hidden='true'
                    >
                      <path d='M6 6l12 12M18 6L6 18' />
                    </svg>
                  ) : (
                    <svg
                      width='18'
                      height='18'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      aria-hidden='true'
                    >
                      <path d='M4 7h16M4 12h16M4 17h16' />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
        <Link className='app-sidebar-foot' href='/' aria-label={t('app.title')}>
          <span className='brand-text'>
            <span className='brand'>{t('app.title')}</span>
          </span>
        </Link>
      </header>
      <div ref={railTipRef} className='nav-rail-tip' hidden role='tooltip' />

      {!refreshShimmer &&
        mobileMenuOpen &&
        portalReady &&
        createPortal(
          <>
            <div
              className='top-menu-backdrop'
              onClick={() => {
                setSheetAccountOpen(false);
                setMobileMenuOpen(false);
              }}
              aria-hidden='true'
            />
            <div
              className='top-actions-panel top-actions-panel--float is-open'
              role='dialog'
              aria-label={t('nav.menu')}
            >
              <div className='nav-sheet-handle' aria-hidden='true' />
              {isLoggedIn && displayName && (
                <div className='nav-sheet-profile-row'>
                  <button
                    type='button'
                    className='nav-user nav-user--menu nav-user--menu-btn'
                    title={`${displayName} · ${userLevel}`}
                    aria-haspopup='dialog'
                    aria-expanded={sheetAccountOpen}
                    aria-label={t('nav.accountMenu')}
                    disabled={busy || loggingOut}
                    onClick={() => setSheetAccountOpen(true)}
                  >
                    <AccountAvatar url={avatarUrl} size={44} />
                    <span className='nav-user-text'>
                      <span className='nav-user-name'>{displayName}</span>
                      <span className='nav-user-level'>{userLevel}</span>
                    </span>
                  </button>
                  <button
                    type='button'
                    className='btn btn-icon nav-sheet-logout'
                    disabled={busy || loggingOut}
                    aria-label={t('nav.logout')}
                    title={t('nav.logout')}
                    onClick={() => {
                      closeMenu();
                      onLogout();
                    }}
                  >
                    <LogoutIcon />
                  </button>
                </div>
              )}
              {!sessionPending && !isLoggedIn && (
                <div className='nav-sheet-profile-row'>
                  <div className='nav-user nav-user--menu nav-user--guest'>
                    <AccountAvatar url='' size={44} />
                    <span className='nav-user-text'>
                      <span className='nav-user-name'>{t('nav.guest')}</span>
                      <span className='nav-user-level'>
                        {t('nav.guestHint')}
                      </span>
                    </span>
                  </div>
                  <button
                    type='button'
                    className='btn btn-primary nav-sheet-login-inline'
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      onLogin();
                    }}
                  >
                    {t('nav.login')}
                  </button>
                </div>
              )}
              <p className='nav-menu-label'>{t('nav.appearance')}</p>
              <div className='nav-menu-prefs'>
                <LanguageToggle />
                <button
                  className='btn btn-icon'
                  type='button'
                  onClick={onToggleTheme}
                  aria-label={
                    theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')
                  }
                  title={
                    theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')
                  }
                >
                  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                </button>
                {isLoggedIn ? <RemainAlertMuteToggle variant='menu' /> : null}
              </div>
              <p className='nav-menu-label'>{t('nav.manage')}</p>
              <div className='nav-sheet-list' role='menu'>
                {manageItems}
              </div>
              {sessionPending ? (
                <NavAccountShimmer
                  label={t('nav.accountLoading')}
                  withAlerts={false}
                />
              ) : null}
            </div>
            {sheetAccountOpen && (
              <div
                className='nav-sheet-account-backdrop'
                onClick={() => setSheetAccountOpen(false)}
              >
                <div
                  className='nav-sheet-account-modal'
                  role='dialog'
                  aria-modal='true'
                  aria-label={t('nav.account')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className='nav-sheet-account-head'>
                    <strong>{t('nav.account')}</strong>
                    <button
                      type='button'
                      className='btn btn-icon'
                      aria-label={t('nav.closeMenu')}
                      onClick={() => setSheetAccountOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type='button'
                    className='nav-sheet-item'
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      void onEditProfile();
                    }}
                  >
                    {t('nav.editProfile')}
                  </button>
                  <button
                    type='button'
                    className='nav-sheet-item'
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      onChangePassword();
                    }}
                  >
                    {t('nav.editPassword')}
                  </button>
                  <p
                    className='nav-session-group-label'
                    role='presentation'
                  >
                    {t('nav.settings')}
                  </p>
                  <div
                    className='nav-session-prefs'
                    role='group'
                    aria-label={t('nav.settings')}
                  >
                    <LanguageToggle />
                    <button
                      className='btn btn-icon'
                      type='button'
                      onClick={onToggleTheme}
                      aria-label={
                        theme === 'dark'
                          ? t('nav.lightMode')
                          : t('nav.darkMode')
                      }
                      title={
                        theme === 'dark'
                          ? t('nav.lightMode')
                          : t('nav.darkMode')
                      }
                    >
                      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                    </button>
                    <RemainAlertMuteToggle variant='menu' />
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
