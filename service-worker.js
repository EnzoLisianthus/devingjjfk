// =========================================================
// JJFK PWA Service Worker v4.6.1
// - Moodle/cross-origin 요청은 절대 가로채거나 캐시하지 않음
// - HTML/JS/CSS는 network-first: 배포 직후 새 코드를 우선 확인
// - manifest/icons는 cache-first
// - 오프라인에서는 마지막 정상 앱 셸로 fallback
// =========================================================

const CACHE_NAME = "jjfk-cache-v4.6.1-deliberate-refresh";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=4.6.1",
  "./app.js?v=4.6.1",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith("jjfk-cache-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Moodle token/API 등 외부 요청은 브라우저 네트워크 스택에 그대로 맡깁니다.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const pathname = url.pathname.toLowerCase();
  const isCodeAsset =
    pathname.endsWith("/app.js") ||
    pathname.endsWith("/style.css") ||
    pathname.endsWith("/index.html");

  if (isCodeAsset) {
    event.respondWith(networkFirstCode(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

async function fetchFresh(request) {
  return fetch(request, { cache: "no-store" });
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetchFresh(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put("./index.html", response.clone());
    }

    return response;
  } catch {
    return (
      (await caches.match("./index.html")) ||
      (await caches.match("./")) ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      })
    );
  }
}

async function networkFirstCode(request) {
  try {
    const response = await fetchFresh(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
