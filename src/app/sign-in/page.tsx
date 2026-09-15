"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/useT";
import { LanguageToggle } from "@/components/LanguageToggle";

function formatWait(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function fetchLockout(username: string): Promise<{
  locked: boolean;
  retryAfterSec: number;
}> {
  const res = await fetch(
    `/api/login-lockout?username=${encodeURIComponent(username)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return { locked: false, retryAfterSec: 0 };
  const body = (await res.json()) as {
    locked?: boolean;
    retryAfterSec?: number;
  };
  return {
    locked: Boolean(body.locked),
    retryAfterSec: Math.max(0, Number(body.retryAfterSec) || 0),
  };
}

function LoginForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockUntilByUser, setLockUntilByUser] = useState<Record<string, number>>(
    {}
  );
  const [now, setNow] = useState(() => Date.now());

  const userKey = username.trim().toLowerCase();
  const lockUntil = lockUntilByUser[userKey] || 0;
  const remainingSec = useMemo(() => {
    if (!lockUntil) return 0;
    return Math.max(0, Math.ceil((lockUntil - now) / 1000));
  }, [lockUntil, now]);
  const locked = remainingSec > 0;

  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [locked]);

  useEffect(() => {
    if (!userKey || !lockUntil || remainingSec > 0) return;
    setLockUntilByUser((prev) => {
      if (!prev[userKey]) return prev;
      const next = { ...prev };
      delete next[userKey];
      return next;
    });
    setError("");
  }, [userKey, lockUntil, remainingSec]);

  function applyLock(user: string, retryAfterSec: number) {
    const key = user.trim().toLowerCase();
    if (!key || retryAfterSec <= 0) return;
    setLockUntilByUser((prev) => ({
      ...prev,
      [key]: Date.now() + retryAfterSec * 1000,
    }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked || busy) return;
    setBusy(true);
    setError("");
    try {
      const precheck = await fetchLockout(username);
      if (precheck.locked) {
        applyLock(username, precheck.retryAfterSec);
        setError(
          t("login.locked", { time: formatWait(precheck.retryAfterSec) })
        );
        return;
      }
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
        callbackUrl,
      });
      if (!result || result.error) {
        const status = await fetchLockout(username);
        if (status.locked) {
          applyLock(username, status.retryAfterSec);
          setError(
            t("login.locked", { time: formatWait(status.retryAfterSec) })
          );
        } else {
          setError(t("login.error"));
        }
        return;
      }
      window.location.href = result.url || callbackUrl;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app app-login">
      <section className="login-card">
        <div className="login-lang">
          <LanguageToggle />
        </div>
        <h1>{t("login.title")}</h1>
        <p>{t("login.hint")}</p>
        <form className="form" onSubmit={onSubmit}>
          <label>
            {t("login.username")}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            {t("login.password")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="error">
              {locked
                ? t("login.locked", { time: formatWait(remainingSec) })
                : error}
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={busy || locked}
            type="submit"
          >
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  const t = useT();
  return (
    <main className="app app-login">
      <section className="login-card">{t("login.loading")}</section>
    </main>
  );
}
