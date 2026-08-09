"use client";

import { FormEvent, Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/useT";
import { LanguageToggle } from "@/components/LanguageToggle";

function LoginForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    setBusy(false);
    if (!result || result.error) {
      setError(t("login.error"));
      return;
    }
    window.location.href = result.url || callbackUrl;
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
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
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
