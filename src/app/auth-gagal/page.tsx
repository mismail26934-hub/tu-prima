"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n/messages";
import { LanguageToggle } from "@/components/LanguageToggle";

const ERROR_KEYS: Record<string, MessageKey> = {
  Configuration: "authGagal.configuration",
  AccessDenied: "authGagal.accessDenied",
  Verification: "authGagal.verification",
  Default: "authGagal.default",
  CredentialsSignin: "login.error",
  Callback: "authGagal.callback",
  OAuthSignin: "authGagal.default",
  OAuthCallback: "authGagal.default",
  SessionRequired: "authGagal.sessionRequired",
};

function AuthGagalContent() {
  const t = useT();
  const searchParams = useSearchParams();
  const code = searchParams.get("error") || "Default";
  const messageKey = ERROR_KEYS[code] || ERROR_KEYS.Default;

  return (
    <main className="app app-login">
      <section className="login-card">
        <div className="login-lang">
          <LanguageToggle />
        </div>
        <h1>{t("authGagal.title")}</h1>
        <p>{t(messageKey)}</p>
        {code !== "Default" && (
          <p className="meta" style={{ marginTop: 8 }}>
            {t("authGagal.code", { code })}
          </p>
        )}
        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/sign-in">
            {t("authGagal.backToSignIn")}
          </Link>
          <Link className="btn" href="/">
            {t("authGagal.backHome")}
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function AuthGagalPage() {
  return (
    <Suspense fallback={<AuthGagalFallback />}>
      <AuthGagalContent />
    </Suspense>
  );
}

function AuthGagalFallback() {
  const t = useT();
  return (
    <main className="app app-login">
      <section className="login-card">{t("login.loading")}</section>
    </main>
  );
}
