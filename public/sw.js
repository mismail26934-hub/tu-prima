const CACHE = "tu-prima-shell-v16";
const SHELL = ["/", "/sign-in", "/auth-gagal", "/manifest.webmanifest"];
/** Shell/nav: fall back to cache quickly. API: allow slow MySQL (was 400ms → false Offline). */
const SHELL_FETCH_MS = 3000;
const API_FETCH_MS = 12000;

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

function isRscRequest(request, url) {
  if (url.searchParams.has("_rsc")) return true;
  const rsc = request.headers.get("RSC");
  if (rsc === "1") return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  if (request.headers.get("Next-Router-Prefetch")) return true;
  if (request.headers.get("Next-Router-Segment-Prefetch")) return true;
  return false;
}

function isCustomerShare(url) {
  return (
    url.pathname === "/" &&
    (url.searchParams.get("view") || "").trim().toLowerCase() === "customer" &&
    Boolean((url.searchParams.get("job") || "").trim())
  );
}

function isHtmlResponse(response) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  return type.includes("text/html");
}

function shellRequest(url) {
  return new Request(url, { credentials: "same-origin" });
}

async function putCopy(cache, request, response) {
  if (!response || !response.ok) return;
  const url = new URL(request.url, self.location.origin);
  if (isRscRequest(request, url)) return;
  if (isCustomerShare(url)) return;
  if (request.mode === "navigate" && !isHtmlResponse(response)) return;
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
        if (parsed.searchParams.has("_rsc")) return Promise.resolve();
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

  if (isRscRequest(request, url)) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === "navigate") {
    const homeFallback = isCustomerShare(url) ? undefined : "/";
    event.respondWith(networkFirst(request, homeFallback, SHELL_FETCH_MS));
    return;
  }

  // Session may be reused offline. Never cache dashboard/API data —
  // stale GET would overwrite optimistic CRUD (e.g. assign 2 → 4).
  if (isAuthSession(url)) {
    event.respondWith(networkFirst(request, undefined, SHELL_FETCH_MS));
    return;
  }

  if (isApi(url)) {
    event.respondWith(networkOnly(request, API_FETCH_MS));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

function isSwOffline() {
  return Boolean(self.navigator && self.navigator.onLine === false);
}

/**
 * DevTools Offline often hangs or returns status-0 / type=error instead of
 * throwing. Race a timeout so we can fall back — but do NOT treat real HTTP
 * 4xx/5xx (!ok) as offline (slow APIs used to trip a 400ms race → flood of 503).
 */
async function fetchFresh(request, ms = SHELL_FETCH_MS) {
  if (isSwOffline()) {
    throw new Error("offline");
  }
  const fresh = await Promise.race([
    fetch(request).then((res) => {
      if (!res || res.type === "error" || res.status === 0) {
        throw new Error("offline");
      }
      return res;
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]);
  return fresh;
}

function offlineJson() {
  return new Response(JSON.stringify({ error: "Offline" }), {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function networkOnly(request, ms = API_FETCH_MS) {
  try {
    return await fetchFresh(request, ms);
  } catch {
    return offlineJson();
  }
}

async function matchCached(cache, request, fallbackUrl) {
  const url = new URL(request.url);
  const documentNav =
    request.mode === "navigate" || request.destination === "document";
  const opts = documentNav ? {} : { ignoreSearch: true };
  const direct = await cache.match(request, opts);
  if (direct && isUsableCached(request, direct)) return direct;
  if (!fallbackUrl || isCustomerShare(url)) return undefined;
  const named = await cache.match(shellRequest(fallbackUrl), opts);
  if (named && isUsableCached(request, named)) return named;
  const fallback = await cache.match(fallbackUrl, opts);
  if (fallback && isUsableCached(request, fallback)) return fallback;
  return undefined;
}

function isUsableCached(request, response) {
  if (!response || !response.ok) return false;
  if (request.mode === "navigate" || request.destination === "document") {
    return isHtmlResponse(response);
  }
  return true;
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

async function networkFirst(request, fallbackUrl, ms = SHELL_FETCH_MS) {
  const cache = await caches.open(CACHE);
  // Prefer cache immediately when the SW already knows we are offline
  // (real NIC down OR DevTools Offline setting navigator.onLine).
  if (isSwOffline()) {
    const cached = await matchCached(cache, request, fallbackUrl);
    if (cached) return cached;
    if (request.mode === "navigate") return offlineDocument();
    return offlineJson();
  }
  try {
    const fresh = await fetchFresh(request, ms);
    // Cache only successful shell/HTML; pass through API errors unchanged.
    if (fresh.ok) {
      await putCopy(cache, request, fresh);
      const reqUrl = new URL(request.url);
      if (
        fallbackUrl &&
        request.mode === "navigate" &&
        isHtmlResponse(fresh) &&
        !isCustomerShare(reqUrl)
      ) {
        await putCopy(cache, shellRequest(fallbackUrl), fresh);
      }
    }
    return fresh;
  } catch {
    /* DevTools Offline / timeout / failed Response */
  }
  const cached = await matchCached(cache, request, fallbackUrl);
  if (cached) return cached;
  if (request.mode === "navigate") return offlineDocument();
  return offlineJson();
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (isSwOffline()) {
    if (cached && cached.ok) return cached;
    return new Response("", { status: 503, statusText: "Offline" });
  }
  const fetching = fetchFresh(request, SHELL_FETCH_MS)
    .then((fresh) => {
      if (fresh.ok) void putCopy(cache, request, fresh);
      return fresh;
    })
    .catch(() => undefined);
  if (cached && cached.ok) {
    void fetching;
    return cached;
  }
  const fresh = await fetching;
  if (fresh && fresh.ok) return fresh;
  if (fresh) return fresh;
  return new Response("", { status: 503, statusText: "Offline" });
}
