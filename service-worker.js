// ===============================
// JJFK PWA Service Worker (FINAL)
// ===============================

const CACHE_NAME = "jjfk-cache-v2";
const NOTI_KEY = "notified-tasks";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

// ===============================
// INSTALL
// ===============================
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// ===============================
// ACTIVATE
// ===============================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );

  self.clients.claim();
});

// ===============================
// FETCH
// ===============================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.includes("/api/")) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

// ===============================
// CACHE STRATEGIES
// ===============================
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  const res = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  cache.put(req, res.clone());

  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response("offline", { status: 503 });
  }
}

// ===============================
// MESSAGE
// ===============================
self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {
    case "SAVE_TASKS":
      await saveToCache("tasks", data.payload);
      break;

    case "GET_TASKS":
      const tasks = await getFromCache("tasks");
      event.ports[0]?.postMessage(tasks || []);
      break;

    case "CHECK_DEADLINES":
      await checkDeadlines(data.payload);
      break;
  }
});

// ===============================
// CACHE HELPERS
// ===============================
async function saveToCache(key, data) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(`data-${key}`, new Response(JSON.stringify(data)));
}

async function getFromCache(key) {
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(`data-${key}`);
  return res ? await res.json() : null;
}

// ===============================
// 🔥 NOTIFICATION STATE STORAGE
// ===============================
async function getNotiState() {
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(NOTI_KEY);
  return res ? await res.json() : {};
}

async function setNotiState(data) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(NOTI_KEY, new Response(JSON.stringify(data)));
}

// ===============================
// 🔥 NOTIFICATION SYSTEM (FINAL)
// ===============================
async function checkDeadlines(tasks) {
  if (!tasks || !Array.isArray(tasks)) return;

  const now = Date.now();
  const notiState = await getNotiState();

  for (const task of tasks) {
    if (!task.deadline || !task.id) continue;

    const deadline = new Date(task.deadline).getTime();
    const diff = deadline - now;

    if (!notiState[task.id]) {
      notiState[task.id] = {
        before4h: false,
        deadline: false,
        expiredAt: null
      };
    }

    const state = notiState[task.id];

    // =========================
    // ⏰ 4시간 전 (1회)
    // =========================
    if (
      diff > 0 &&
      diff <= 4 * 60 * 60 * 1000 &&
      !state.before4h
    ) {
      self.registration.showNotification("⏰ 마감 4시간 전", {
        body: task.title || "과제 마감 4시간 전입니다.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png"
      });

      state.before4h = true;
    }

    // =========================
    // 🚨 마감 (1회)
    // =========================
    if (diff <= 0 && !state.deadline) {
      self.registration.showNotification("🚨 마감 완료", {
        body: task.title || "과제가 마감되었습니다.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png"
      });

      state.deadline = true;
      state.expiredAt = now;
    }

    // =========================
    // 🧹 24시간 후 삭제
    // =========================
    if (
      state.expiredAt &&
      now - state.expiredAt > 24 * 60 * 60 * 1000
    ) {
      delete notiState[task.id];
    }
  }

  await setNotiState(notiState);
}

// ===============================
// PUSH (확장)
// ===============================
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  self.registration.showNotification(data.title || "알림", {
    body: data.body || "",
    icon: "./icons/icon-192.png"
  });
});
