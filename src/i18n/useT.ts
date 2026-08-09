"use client";

import { useEffect } from "react";
import { translate, type MessageKey } from "@/i18n/messages";
import { useLocaleStore } from "@/store/localeStore";

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
}

export function useLocale() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const hydrate = useLocaleStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return { locale, setLocale };
}
