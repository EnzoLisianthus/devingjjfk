// =========================================================
// JJFK PWA Service Worker v4
// - 알림 기능 제거: 캐싱/오프라인 셸만 담당
// - cross-origin Moodle API 요청은 절대 캐시하지 않음
// - 새 버전 설치 시 즉시 활성화
// =========================================================

const CACHE_NAME = "jjfk-cache-v4-liquid";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=4",
  "./app.js?v=4",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

// =========================
// INSTALL
// =========================
self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// =========================
// ACTIVATE
// =========================
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

// =========================
// FETCH
// =========================
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 중요: cyber.jj.ac.kr의 토큰/API 응답 및 다른 외부 요청은
  // 서비스워커에서 캐시하거나 가로채지 않습니다.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

// =========================
// STRATEGIES
// =========================
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);

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
