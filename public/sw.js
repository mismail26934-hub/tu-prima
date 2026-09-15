const CACHE = "tu-prima-shell-v9";
const SHELL = ["/", "/sign-in", "/auth-gagal", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(precache(SHELL).then(() => self.skipWaiting()));
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

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;
  event.waitUntil(precache(data.urls));
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isAuthSession(url) {
  return url.pathname.startsWith("/api/session/session");
}

function shellRequest(url) {
  return new Request(url, { credentials: "same-origin" });
}

async function putCopy(cache, request, response) {
  if (!response || !response.ok) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    /* quota / opaque */
  }
}

async function putUrl(cache, url) {
  try {
    const req = shellRequest(url);
    const res = await fetch(req);
    await putCopy(cache, req, res);
  } catch {
    /* skip failed shell entry instead of aborting the rest */
  }
}

async function precache(urls) {
  const cache = await caches.open(CACHE);
  const unique = [...new Set(urls.filter(Boolean).map((url) => String(url)))];
  await Promise.all(
    unique.map((url) => {
      try {
        const parsed = new URL(url, self.location.origin);
        if (parsed.origin !== self.location.origin) return Promise.resolve();
        if (parsed.pathname.startsWith("/api/")) return Promise.resolve();
        if (parsed.pathname === "/ws") return Promise.resolve();
        return putUrl(cache, parsed.href);
      } catch {
        return Promise.resolve();
      }
    })
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/ws") return;

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

async function matchCached(cache, request, fallbackUrl) {
  const opts = { ignoreSearch: true, ignoreVary: true };
  const direct = await cache.match(request, opts);
  if (direct) return direct;
  if (!fallbackUrl) return undefined;
  const named = await cache.match(shellRequest(fallbackUrl), opts);
  if (named) return named;
  return cache.match(fallbackUrl, opts);
}

function offlineDocument() {
  return new Response(
    `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>PRIMA — Offline</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12151a;color:#e8edf4;font-family:Segoe UI,sans-serif}
    main{max-width:28rem;padding:24px;text-align:center}
    h1{margin:0;font-size:2.4rem;letter-spacing:.06em;color:#e8a317}
    p{color:#9aa6b5;line-height:1.45}
    button{margin-top:12px;border:0;border-radius:10px;padding:10px 16px;font-weight:700;background:#e8a317;color:#1a1204;cursor:pointer}
  </style>
</head>
<body>
  <main>
    <h1>PRIMA</h1>
    <p>Belum ada salinan lokal. Buka aplikasi sekali saat online, lalu refresh offline akan memakai cache.</p>
    <button type="button" onclick="location.reload()">Coba lagi</button>
  </main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      await putCopy(cache, request, fresh);
      if (fallbackUrl && request.mode === "navigate") {
        await putCopy(cache, shellRequest(fallbackUrl), fresh);
      }
    }
    if (fresh) return fresh;
  } catch {
    /* offline / DevTools Offline */
  }
  const cached = await matchCached(cache, request, fallbackUrl);
  if (cached) return cached;
  if (request.mode === "navigate") return offlineDocument();
  return new Response("", { status: 503, statusText: "Offline" });
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, {
    ignoreSearch: true,
    ignoreVary: true,
  });
  const fetching = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) void putCopy(cache, request, fresh);
      return fresh;
    })
    .catch(() => undefined);
  if (cached) {
    void fetching;
    return cached;
  }
  const fresh = await fetching;
  if (fresh) return fresh;
  return new Response("", { status: 503, statusText: "Offline" });
}
