"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NavAlerts } from "@/components/NavAlerts";
import { NavHeaderPopBackdrop } from "@/components/NavHeaderPopBackdrop";
import { OfflineSyncChip } from "@/components/OfflineSyncChip";
import { RemainAlertMuteToggle } from "@/components/RemainAlertMuteToggle";
import { useT } from "@/i18n/useT";
import type { NavAlertKind } from "@/lib/nav-alerts";
import type { UserLevel } from "@/lib/types";

type BoardTopbarProps = {
  busy: boolean;
  loggingOut: boolean;
  theme: "light" | "dark";
  isLoggedIn: boolean;
  sessionPending: boolean;
  sessionShimmerWithAlerts: boolean;
  showNavAlerts: boolean;
  userLevel: UserLevel | string;
  displayName: string;
  displayNameShort: string;
  avatarUrl: string;
  canJobCreate: boolean;
  canUnitRead: boolean;
  canTemplateRead: boolean;
  modalOpen: boolean;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onNewJob: () => void;
  onSettings: () => void;
  onTechnicians: () => void;
  onUsersMaster: () => void;
  onUnitsMaster: () => void;
  onTemplatesMaster: () => void;
  onAttendance: () => void;
  onExportExcel: () => void;
  onJobBackups: () => void;
  onEditProfile: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onOpenJob: (jobId: string, kind?: NavAlertKind) => void;
};

function ShimmerBlock({ className = "" }: { className?: string }) {
  return <span className={`shimmer-block ${className}`.trim()} aria-hidden="true" />;
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
      className="nav-session-shimmer"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      {withAlerts ? (
        <>
          <ShimmerBlock className="shimmer-block--nav-icon" />
          <ShimmerBlock className="shimmer-block--nav-icon" />
        </>
      ) : null}
      <span className="nav-account-shimmer" aria-hidden="true">
        <span className="nav-user">
          <ShimmerBlock className="shimmer-block--nav-name" />
          <ShimmerBlock className="shimmer-block--nav-level" />
        </span>
        <ShimmerBlock className="shimmer-block--nav-avatar" />
      </span>
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
      <span
        className="nav-avatar"
        style={{
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
        }}
      >
        <svg
          width={Math.max(14, Math.round(size * 0.55))}
          height={Math.max(14, Math.round(size * 0.55))}
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

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.1-5.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function LogoutIcon() {
  return (
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function BoardTopbar({
  busy,
  loggingOut,
  theme,
  isLoggedIn,
  sessionPending,
  sessionShimmerWithAlerts,
  showNavAlerts,
  userLevel,
  displayName,
  displayNameShort,
  avatarUrl,
  canJobCreate,
  canUnitRead,
  canTemplateRead,
  modalOpen,
  onRefresh,
  onToggleTheme,
  onNewJob,
  onSettings,
  onTechnicians,
  onUsersMaster,
  onUnitsMaster,
  onTemplatesMaster,
  onAttendance,
  onExportExcel,
  onJobBackups,
  onEditProfile,
  onChangePassword,
  onLogout,
  onLogin,
  onOpenJob,
}: BoardTopbarProps) {
  const t = useT();
  const topbarRef = useRef<HTMLElement>(null);
  const manageRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionMenuPos, setSessionMenuPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [sheetAccountOpen, setSheetAccountOpen] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    let lastHeight = -1;
    const sync = () => {
      const box = el.getBoundingClientRect();
      const height = Math.ceil(box.height);
      const bottom = Math.ceil(box.bottom);
      const scrollY =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      el.classList.toggle("is-scrolled", scrollY > 4);
      document.documentElement.classList.toggle("topbar-scrolled", scrollY > 4);
      setScrolled(scrollY > 4);
      if (height !== lastHeight) {
        lastHeight = height;
        document.documentElement.style.setProperty(
          "--topbar-height",
          `${height}px`
        );
      }
      document.documentElement.style.setProperty(
        "--topbar-offset",
        `${bottom + 8}px`
      );
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
      document.documentElement.classList.remove("topbar-scrolled");
    };
  }, []);

  useEffect(() => {
    if (!manageOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setManageOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [manageOpen]);

  useEffect(() => {
    if (!sessionOpen || mobileMenuOpen) {
      setSessionMenuPos(null);
      return;
    }
    function syncPos() {
      const el = sessionRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      setSessionMenuPos({
        top: Math.round(box.bottom + 6),
        right: Math.round(window.innerWidth - box.right),
      });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSessionOpen(false);
    }
    syncPos();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", syncPos);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", syncPos);
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
    if (modalOpen) {
      setManageOpen(false);
      setSessionOpen(false);
      setMobileMenuOpen(false);
    }
  }, [modalOpen]);

  useEffect(() => {
    function onPop(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "manage") {
        setSessionOpen(false);
        return;
      }
      if (detail === "session") {
        setManageOpen(false);
        return;
      }
      setManageOpen(false);
      setSessionOpen(false);
    }
    window.addEventListener("prima-header-pop", onPop);
    return () => window.removeEventListener("prima-header-pop", onPop);
  }, []);

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

  function closeMenu() {
    setMobileMenuOpen(false);
    setSessionOpen(false);
    setManageOpen(false);
    setSheetAccountOpen(false);
  }

  const manageItems = (
    <>
      <button
        type="button"
        role="menuitem"
        className="nav-manage-item"
        disabled={busy}
        onClick={() => {
          closeMenu();
          onSettings();
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
          closeMenu();
          onTechnicians();
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
            closeMenu();
            onUsersMaster();
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
          closeMenu();
          onUnitsMaster();
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
          closeMenu();
          onTemplatesMaster();
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
          closeMenu();
          onAttendance();
        }}
      >
        {t("nav.attendance")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="nav-manage-item"
        disabled={busy || !isLoggedIn}
        title={isLoggedIn ? t("nav.exportExcelTip") : t("nav.exportNeedLogin")}
        onClick={() => {
          closeMenu();
          onExportExcel();
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
            closeMenu();
            onJobBackups();
          }}
        >
          {t("nav.backupUndo")}
        </button>
      )}
    </>
  );

  return (
    <>
      {portalReady &&
        createPortal(
          <div
            className={`topbar-glass${scrolled ? " is-scrolled" : ""}`}
            aria-hidden="true"
          />,
          document.body
        )}
      <NavHeaderPopBackdrop
        open={manageOpen || sessionOpen}
        onClose={() => {
          setManageOpen(false);
          setSessionOpen(false);
        }}
      />
      <header className="topbar" ref={topbarRef}>
        <div>
          <div className="brand">
            <div className="brand-row">
              {t("app.title")}
              <OfflineSyncChip onRefresh={onRefresh} refreshBusy={busy} />
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
                  const next = !manageOpen;
                  if (next) {
                    window.dispatchEvent(
                      new CustomEvent("prima-header-pop", { detail: "manage" })
                    );
                  }
                  setManageOpen(next);
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
                  {manageItems}
                </div>
              )}
            </div>
            <button
              className="btn btn-icon"
              disabled={busy}
              type="button"
              onClick={onRefresh}
              aria-label={t("nav.refresh")}
              title={t("nav.refresh")}
            >
              <RefreshIcon />
            </button>
            <LanguageToggle />
            <button
              className="btn btn-icon"
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
              title={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={onNewJob}
            >
              {t("nav.newJob")}
            </button>
            <div className="nav-end">
              {sessionPending ? (
                <NavAccountShimmer
                  label={t("nav.accountLoading")}
                  withAlerts={sessionShimmerWithAlerts}
                />
              ) : (
                <>
                  {isLoggedIn ? (
                    <RemainAlertMuteToggle
                      onBeforeOpen={() => {
                        setManageOpen(false);
                        setSessionOpen(false);
                      }}
                    />
                  ) : null}
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
                            const next = !sessionOpen;
                            if (next) {
                              window.dispatchEvent(
                                new CustomEvent("prima-header-pop", {
                                  detail: "session",
                                })
                              );
                              const el = sessionRef.current;
                              if (el) {
                                const box = el.getBoundingClientRect();
                                setSessionMenuPos({
                                  top: Math.round(box.bottom + 6),
                                  right: Math.round(
                                    window.innerWidth - box.right
                                  ),
                                });
                              }
                            } else {
                              setSessionMenuPos(null);
                            }
                            setSessionOpen(next);
                          }}
                        >
                          <span className="nav-user">
                            <span className="nav-user-name">{displayNameShort}</span>
                            <span className="nav-user-level">{userLevel}</span>
                          </span>
                          <AccountAvatar url={avatarUrl} size={28} />
                        </button>
                        {sessionOpen &&
                          portalReady &&
                          sessionMenuPos &&
                          createPortal(
                            <div
                              className="nav-manage-menu nav-session-portal-menu"
                              role="menu"
                              style={{
                                top: sessionMenuPos.top,
                                right: sessionMenuPos.right,
                              }}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="nav-manage-item"
                                disabled={busy || loggingOut}
                                onClick={() => {
                                  closeMenu();
                                  void onEditProfile();
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
                                  closeMenu();
                                  onChangePassword();
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
                                  closeMenu();
                                  onLogout();
                                }}
                              >
                                {t("nav.logout")}
                              </button>
                            </div>,
                            document.body
                          )}
                      </div>
                    ) : (
                      <button
                        className="btn"
                        disabled={busy || loggingOut}
                        onClick={onLogin}
                      >
                        {t("nav.login")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="top-actions-mobile">
            <button
              className="btn btn-primary"
              disabled={busy || !canJobCreate}
              onClick={onNewJob}
            >
              {t("nav.newJobShort")}
            </button>
            <button
              className="btn btn-icon"
              type="button"
              disabled={busy}
              onClick={onRefresh}
              aria-label={t("nav.refresh")}
              title={t("nav.refresh")}
            >
              <RefreshIcon />
            </button>
            {sessionPending ? (
              sessionShimmerWithAlerts ? (
                <span className="nav-session-shimmer" aria-hidden="true">
                  <ShimmerBlock className="shimmer-block--nav-icon" />
                  <ShimmerBlock className="shimmer-block--nav-icon" />
                </span>
              ) : (
                <ShimmerBlock className="shimmer-block--nav-icon" />
              )
            ) : (
              <>
                {isLoggedIn ? (
                  <RemainAlertMuteToggle
                    onBeforeOpen={() => {
                      setSessionOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  />
                ) : null}
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
              </>
            )}
            <button
              className="btn btn-icon top-menu-toggle"
              type="button"
              aria-label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={mobileMenuOpen}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("prima-header-pop", { detail: "menu" })
                );
                setMobileMenuOpen((o) => !o);
              }}
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

      {mobileMenuOpen &&
        portalReady &&
        createPortal(
          <>
            <div
              className="top-menu-backdrop"
              onClick={() => {
                setSheetAccountOpen(false);
                setMobileMenuOpen(false);
              }}
              aria-hidden="true"
            />
            <div
              className="top-actions-panel top-actions-panel--float is-open"
              role="dialog"
              aria-label={t("nav.menu")}
            >
              <div className="nav-sheet-handle" aria-hidden="true" />
              {isLoggedIn && displayName && (
                <div className="nav-sheet-profile-row">
                  <button
                    type="button"
                    className="nav-user nav-user--menu nav-user--menu-btn"
                    title={`${displayName} · ${userLevel}`}
                    aria-haspopup="dialog"
                    aria-expanded={sheetAccountOpen}
                    aria-label={t("nav.accountMenu")}
                    disabled={busy || loggingOut}
                    onClick={() => setSheetAccountOpen(true)}
                  >
                    <AccountAvatar url={avatarUrl} size={44} />
                    <span className="nav-user-text">
                      <span className="nav-user-name">{displayName}</span>
                      <span className="nav-user-level">{userLevel}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon nav-sheet-logout"
                    disabled={busy || loggingOut}
                    aria-label={t("nav.logout")}
                    title={t("nav.logout")}
                    onClick={() => {
                      closeMenu();
                      onLogout();
                    }}
                  >
                    <LogoutIcon />
                  </button>
                </div>
              )}
              <p className="nav-menu-label">{t("nav.appearance")}</p>
              <div className="nav-menu-prefs">
                <LanguageToggle />
                <button
                  className="btn btn-icon"
                  type="button"
                  onClick={onToggleTheme}
                  aria-label={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
                  title={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
                >
                  {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                </button>
              </div>
              <p className="nav-menu-label">{t("nav.manage")}</p>
              <div className="nav-sheet-list" role="menu">
                {manageItems}
              </div>
              {sessionPending ? (
                <NavAccountShimmer
                  label={t("nav.accountLoading")}
                  withAlerts={false}
                />
              ) : (
                !isLoggedIn && (
                  <button
                    className="btn btn-primary nav-sheet-login"
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      onLogin();
                    }}
                  >
                    {t("nav.login")}
                  </button>
                )
              )}
            </div>
            {sheetAccountOpen && (
              <div
                className="nav-sheet-account-backdrop"
                onClick={() => setSheetAccountOpen(false)}
              >
                <div
                  className="nav-sheet-account-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("nav.account")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="nav-sheet-account-head">
                    <strong>{t("nav.account")}</strong>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={t("nav.closeMenu")}
                      onClick={() => setSheetAccountOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    className="nav-sheet-item"
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      void onEditProfile();
                    }}
                  >
                    {t("nav.editProfile")}
                  </button>
                  <button
                    type="button"
                    className="nav-sheet-item"
                    disabled={busy || loggingOut}
                    onClick={() => {
                      closeMenu();
                      onChangePassword();
                    }}
                  >
                    {t("nav.editPassword")}
                  </button>
                </div>
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
