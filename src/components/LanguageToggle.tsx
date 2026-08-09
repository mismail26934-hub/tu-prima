"use client";

import { useLocaleStore } from "@/store/localeStore";
import { useEffect } from "react";
import { useT } from "@/i18n/useT";

/** Single icon-style button, same pattern as light/dark theme toggle. */
export function LanguageToggle() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);
  const toggleLocale = useLocaleStore((s) => s.toggleLocale);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Show the locale you switch *to* (same idea as sun/moon on theme).
  const next = locale === "id" ? "EN" : "ID";
  const label =
    locale === "id" ? t("nav.switchToEn") : t("nav.switchToId");

  return (
    <button
      className="btn btn-icon lang-toggle-icon"
      type="button"
      onClick={toggleLocale}
      aria-label={label}
      title={label}
    >
      <span className="lang-toggle-code" aria-hidden="true">
        {next}
      </span>
    </button>
  );
}
