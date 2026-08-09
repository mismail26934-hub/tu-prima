"use client";

import { create } from "zustand";
import type { Locale } from "@/i18n/messages";

const STORAGE_KEY = "tu-prima-locale";

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "id";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "id") return raw;
  } catch {
    /* ignore */
  }
  return "id";
}

interface LocaleState {
  locale: Locale;
  hydrated: boolean;
  hydrate: () => void;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: "id",
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ locale: readStoredLocale(), hydrated: true });
  },
  setLocale: (locale) => {
    set({ locale, hydrated: true });
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  },
  toggleLocale: () => {
    const next: Locale = get().locale === "id" ? "en" : "id";
    get().setLocale(next);
  },
}));
