// =========================================================
// JJFK Assignment Hub v4
// - 기존 Moodle API/토큰 구조 유지
// - Liquid Glass UI용 DOM 렌더링
// - 네트워크/중복 로드/서비스워커 업데이트 안정성 보강
// =========================================================

const APP_VERSION = "4-liquid";
const BASE_URL = "https://cyber.jj.ac.kr/webservice/rest/server.php";
const TOKEN_URL = "https://cyber.jj.ac.kr/login/token.php";
const REFRESH_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

// 현재 프로젝트의 기존 필터 정책을 유지합니다.
const MAX_FUTURE_DAYS = 16;
const MAX_PAST_MS = 86_400_000;

// =========================
// STATE
// =========================
const State = {
  token: null,
  data: [],
  interval: null,
  loading: false,
  initialized: false
};

// =========================
// STORE
// =========================
const Store = {
  get(key) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    } catch (error) {
      console.warn(`[Store] ${key} 값을 읽지 못했습니다.`, error);
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`[Store] ${key} 값을 저장하지 못했습니다.`, error);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`[Store] ${key} 값을 삭제하지 못했습니다.`, error);
    }
  }
};

// =========================
// ENV / HELPERS
// =========================
function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDeadline(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "마감 일시 확인 불가";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}.${month}.${day} ${hour}:${minute}`;
}

async function fetchJSON(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("서버 응답이 올바른 JSON 형식이 아닙니다.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

// =========================
// AUTH
// =========================
const Auth = {
  getToken() {
    return Store.get("token");
  },

  async login(username, password) {
    const cleanUsername = String(username ?? "").trim();
    const cleanPassword = String(password ?? "");

    if (!cleanUsername || !cleanPassword) {
      throw new Error("학번과 비밀번호를 모두 입력해 주세요.");
    }

    const url =
      `${TOKEN_URL}?username=${encodeURIComponent(cleanUsername)}` +
      `&password=${encodeURIComponent(cleanPassword)}` +
      `&service=moodle_mobile_app`;

    const data = await fetchJSON(url);

    if (!data?.token) {
      const message = data?.error || data?.errorcode || "로그인에 실패했습니다.";
      throw new Error(String(message));
    }

    Store.set("token", data.token);
    State.token = data.token;

    return data.token;
  },

  logout() {
    Store.remove("token");
    State.token = null;
    State.data = [];

    if (State.interval) {
      clearInterval(State.interval);
      State.interval = null;
    }

    UI.renderLogin();
  }
};

// =========================
// API
// =========================
const API = {
  async fetchAssignments(token) {
    const url =
      `${BASE_URL}?moodlewsrestformat=json` +
      `&wsfunction=mod_assign_get_assignments` +
      `&wstoken=${encodeURIComponent(token)}`;

    return await fetchJSON(url);
  }
};

// =========================
// DATA
// =========================
const Data = {
  normalize(raw) {
    if (!Array.isArray(raw?.courses)) return [];

    const result = [];

    raw.courses.forEach(course => {
      if (!Array.isArray(course?.assignments) || course.assignments.length === 0) {
        return;
      }

      const assignments = course.assignments
        .map(a => ({
          id: a?.id,
          title: String(a?.name ?? "제목 없는 과제"),
          deadline: Number(a?.duedate) * 1000
        }))
        .filter(a => Number.isFinite(a.deadline) && a.deadline > 0);

      if (assignments.length === 0) return;

      result.push({
        courseName: String(course?.fullname ?? "과목명 없음"),
        assignments
      });
    });

    return result;
  },

  sort(data) {
    const sorted = data.map(course => ({
      ...course,
      assignments: [...course.assignments].sort(
        (a, b) => a.deadline - b.deadline
      )
    }));

    // 과목 그룹 역시 가장 가까운 과제 마감일 순으로 배치합니다.
    sorted.sort((a, b) => {
      const aFirst = a.assignments[0]?.deadline ?? Infinity;
      const bFirst = b.assignments[0]?.deadline ?? Infinity;
      return aFirst - bFirst;
    });

    return sorted;
  }
};

// =========================
// FILTER
// =========================
const Filter = {
  apply(data) {
    const now = Date.now();
    const maxFutureMs = MAX_FUTURE_DAYS * 86_400_000;

    return data
      .map(course => {
        const assignments = course.assignments.filter(a => {
          const diff = a.deadline - now;

          if (diff > maxFutureMs) return false;
          if (diff < -MAX_PAST_MS) return false;

          return true;
        });

        return { ...course, assignments };
      })
      .filter(course => course.assignments.length > 0);
  }
};

// =========================
// STATUS LOGIC
// =========================
const Logic = {
  calcStatus(deadline) {
    const diff = deadline - Date.now();

    if (diff < 0) {
      return {
        color: "red",
        text: this.formatPassed(-diff)
      };
    }

    return {
      color: diff < 3 * 86_400_000 ? "orange" : "green",
      text: this.formatRemain(diff)
    };
  },

  formatRemain(ms) {
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);

    return `${d}일 ${h}시간 ${m}분 남음`;
  },

  formatPassed(ms) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);

    return `마감 ${h}시간 ${m}분 경과`;
  }
};

// =========================
// UI
// =========================
const UI = {
  loadingLayer: null,
  loginLayer: null,
  dashboardLayer: null,
  appView: null,
  loadingText: null,
  loginForm: null,
  loginId: null,
  loginPw: null,
  loginButton: null,
  authError: null,
  logoutButton: null,
  toastLayer: null,

  initRefs() {
    this.loadingLayer = document.getElementById("loading-layer");
    this.loginLayer = document.getElementById("login-layer");
    this.dashboardLayer = document.getElementById("dashboard-layer");
    this.appView = document.getElementById("app-view");
    this.loadingText = document.getElementById("loading-text");
    this.loginForm = document.getElementById("login-form");
    this.loginId = document.getElementById("login-id");
    this.loginPw = document.getElementById("login-pw");
    this.loginButton = document.getElementById("login-btn");
    this.authError = document.getElementById("auth-error");
    this.logoutButton = document.getElementById("logout-btn");
    this.toastLayer = document.getElementById("toast-layer");
  },

  bindEvents() {
    this.loginForm?.addEventListener("submit", async event => {
      event.preventDefault();

      if (State.loading) return;

      const username = this.loginId?.value ?? "";
      const password = this.loginPw?.value ?? "";

      this.setAuthError("");
      this.setLoginBusy(true);

      try {
        await Auth.login(username, password);

        if (this.loginPw) this.loginPw.value = "";

        await App.load({ showLoading: true });
        App.startAutoRefresh();
      } catch (error) {
        const message =
          error?.name === "AbortError"
            ? "로그인 요청 시간이 초과되었습니다. 네트워크를 확인해 주세요."
            : error?.message || "로그인에 실패했습니다.";

        this.setAuthError(message);
      } finally {
        this.setLoginBusy(false);
      }
    });

    this.logoutButton?.addEventListener("click", () => {
      Auth.logout();
    });
  },

  show(layer) {
    if (!layer) return;

    document.querySelectorAll(".layer").forEach(item => {
      item.classList.remove("active");
      item.setAttribute("aria-hidden", "true");
    });

    layer.classList.add("active");
    layer.setAttribute("aria-hidden", "false");
  },

  renderLoading(message = "과제 정보를 불러오는 중") {
    if (this.loadingText) this.loadingText.textContent = message;
    this.show(this.loadingLayer);
  },

  renderLogin() {
    this.setAuthError("");
    this.setLoginBusy(false);
    this.show(this.loginLayer);

    requestAnimationFrame(() => {
      this.loginId?.focus({ preventScroll: true });
    });
  },

  renderBrowserMode() {
    const app = document.getElementById("app");
    if (!app) return;

    app.innerHTML = `
      <div class="browser-mode">
        <div class="browser-mode-card liquid-glass liquid-glass-strong">
          <h1 class="browser-mode-title">Assignment Hub</h1>
          <p>이 앱은 홈 화면에 추가한 뒤 사용하는 Standalone PWA입니다.</p>
          <p>Safari에서 공유 버튼 → <strong>홈 화면에 추가</strong>를 선택해 주세요.</p>
        </div>
      </div>
    `;
  },

  renderDashboard(data) {
    if (!this.appView) return;

    this.show(this.dashboardLayer);

    if (!Array.isArray(data) || data.length === 0) {
      this.appView.innerHTML = `
        <div class="empty-state">
          현재 표시할 과제가 없습니다.
        </div>
      `;
      return;
    }

    const html = data.map(course => {
      const assignments = course.assignments.map(assignment => {
        const status = Logic.calcStatus(assignment.deadline);

        return `
          <article class="assignment-row">
            <div class="assignment-main">
              <div class="assignment-title">${escapeHTML(assignment.title)}</div>
              <div class="assignment-deadline">마감 ${formatDeadline(assignment.deadline)}</div>
            </div>
            <div class="status ${status.color}">${escapeHTML(status.text)}</div>
          </article>
        `;
      }).join("");

      return `
        <section class="course-block">
          <div class="course-heading">
            <div class="course-title">${escapeHTML(course.courseName)}</div>
            <div class="course-count">${course.assignments.length}개</div>
          </div>
          <div class="course-surface liquid-glass">
            ${assignments}
          </div>
        </section>
      `;
    }).join("");

    this.appView.innerHTML = html;
  },

  setLoginBusy(busy) {
    if (!this.loginButton) return;

    this.loginButton.disabled = busy;
    this.loginButton.textContent = busy ? "로그인 중…" : "로그인";
  },

  setAuthError(message) {
    if (this.authError) this.authError.textContent = message ?? "";
  },

  toast(message, duration = 2800) {
    if (!this.toastLayer || !message) return;

    this.toastLayer.innerHTML = "";

    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;

    this.toastLayer.appendChild(element);

    window.setTimeout(() => {
      if (element.isConnected) element.remove();
    }, duration);
  }
};

// =========================
// PWA SERVICE WORKER
// =========================
const PWA = {
  register() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;

    const hadController = Boolean(navigator.serviceWorker.controller);
    const reloadKey = `jjfk-sw-reloaded-${APP_VERSION}`;

    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          "./service-worker.js",
          { scope: "./" }
        );

        // GitHub Pages/PWA에서 장시간 열린 경우에도 새 SW를 확인합니다.
        registration.update().catch(() => {});

        if (hadController) {
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (sessionStorage.getItem(reloadKey)) return;

            sessionStorage.setItem(reloadKey, "1");
            window.location.reload();
          });
        }
      } catch (error) {
        console.warn("[PWA] Service Worker 등록 실패", error);
      }
    }, { once: true });
  }
};

// =========================
// APP CONTROLLER
// =========================
const App = {
  async init() {
    if (State.initialized) return;
    State.initialized = true;

    UI.initRefs();
    UI.bindEvents();
    PWA.register();

    if (!isStandalone()) {
      UI.renderBrowserMode();
      return;
    }

    State.token = Auth.getToken();

    if (!State.token) {
      UI.renderLogin();
      return;
    }

    UI.renderLoading();

    const loaded = await this.load({ showLoading: false });

    if (loaded && State.token) {
      this.startAutoRefresh();
    }

    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        State.token &&
        !State.loading
      ) {
        this.load({ showLoading: false });
      }
    });
  },

  async load({ showLoading = false } = {}) {
    if (State.loading || !State.token) return false;

    State.loading = true;

    if (showLoading) {
      UI.renderLoading();
    }

    try {
      const raw = await API.fetchAssignments(State.token);

      if (raw?.errorcode || raw?.exception) {
        Store.remove("token");
        State.token = null;

        UI.renderLogin();
        UI.setAuthError("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");

        return false;
      }

      let data = Data.normalize(raw);
      data = Filter.apply(data);
      data = Data.sort(data);

      State.data = data;
      UI.renderDashboard(data);

      return true;
    } catch (error) {
      console.error("[App.load]", error);

      const message =
        error?.name === "AbortError"
          ? "서버 응답 시간이 초과되었습니다."
          : "과제 정보를 불러오지 못했습니다. 네트워크를 확인해 주세요.";

      if (State.data.length > 0) {
        UI.renderDashboard(State.data);
        UI.toast(message);
      } else {
        UI.renderLogin();
        UI.setAuthError(message);
      }

      return false;
    } finally {
      State.loading = false;
    }
  },

  startAutoRefresh() {
    if (State.interval) {
      clearInterval(State.interval);
    }

    State.interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        State.token &&
        !State.loading
      ) {
        this.load({ showLoading: false });
      }
    }, REFRESH_INTERVAL_MS);
  }
};

// =========================
// BOOT
// =========================
window.addEventListener("DOMContentLoaded", () => {
  App.init().catch(error => {
    console.error("[Boot]", error);

    // 초기화 자체가 실패하더라도 빈 화면에 갇히지 않도록 마지막 방어선.
    try {
      UI.initRefs();
      UI.renderLogin();
      UI.setAuthError("앱 초기화 중 오류가 발생했습니다. 다시 실행해 주세요.");
    } catch (fallbackError) {
      console.error("[Boot fallback]", fallbackError);
    }
  });
});
