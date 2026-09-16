"use client";

import { useEffect } from "react";

function collectCacheUrls(): string[] {
  const urls = new Set<string>([
    "/",
    "/sign-in",
    "/auth-gagal",
    "/manifest.webmanifest",
  ]);
  document
    .querySelectorAll("script[src], link[rel='stylesheet'][href], link[rel='preload'][href]")
    .forEach((node) => {
      const el = node as HTMLScriptElement | HTMLLinkElement;
      const href =
        "src" in el && el.src ? el.src : "href" in el ? el.href : "";
      if (href && href.startsWith(window.location.origin)) urls.add(href);
    });
  return [...urls];
}

function pushCacheUrls(worker: ServiceWorker | null | undefined) {
  if (!worker) return;
  worker.postMessage({ type: "CACHE_URLS", urls: collectCacheUrls() });
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          void reg.update();
          pushCacheUrls(reg.active || reg.waiting || reg.installing);
          return navigator.serviceWorker.ready.then((ready) => {
            pushCacheUrls(ready.active);
          });
        })
        .catch(() => {
          /* ignore: first load without public/sw.js or insecure origin */
        });
    };

    const onControllerChange = () => {
      pushCacheUrls(navigator.serviceWorker.controller);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, []);
  return null;
}
