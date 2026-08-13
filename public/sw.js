const CACHE = "tu-prima-shell-v2";
const SHELL = ["/", "/login", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isAuthSession(url) {
  return url.pathname.startsWith("/api/auth/session");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  // Session may be reused offline. Never cache dashboard/API data —
  // stale GET would overwrite optimistic CRUD (e.g. assign 2 → 4).
  if (isAuthSession(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isApi(url)) {
    event.respondWith(networkOnly(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkOnly(request) {
  return fetch(request);
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
      if (fallbackUrl && request.mode === "navigate") {
        cache.put(fallbackUrl, fresh.clone());
      }
    }
    return fresh;
  } catch {
    const cached =
      (await cache.match(request)) ||
      (fallbackUrl ? await cache.match(fallbackUrl) : undefined);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || fetching;
}
