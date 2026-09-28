// =========================================================
// JJFK Assignment Hub v4.2 DEBUG
// - Liquid Glass UI 유지
// - 화면 남은 시간 갱신과 Moodle 네트워크 갱신 완전 분리
// - iOS/PWA 타이머 정지·백그라운드 복귀 대응
// - 중복 네트워크 요청 방지
// =========================================================

const APP_VERSION = "4.2-liquid-debug";
const BASE_URL = "https://cyber.jj.ac.kr/webservice/rest/server.php";
const TOKEN_URL = "https://cyber.jj.ac.kr/login/token.php";

// 서버에서 새 과제/마감 변경을 확인하는 주기입니다.
const NETWORK_REFRESH_INTERVAL_MS = 60_000;

// 화면의 남은 시간은 서버 요청과 무관하게 로컬 시계로 갱신합니다.
// 표시 단위가 '분'이므로 10초 주기로 충분하며 경계 전환도 자연스럽습니다.
const CLOCK_TICK_INTERVAL_MS = 10_000;

// 과제 필터 구조(16일/마감 1일)를 다시 계산하는 주기입니다.
const LOCAL_RECONCILE_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

// =========================
// BUILT-IN DEBUG BACKEND
// =========================
// 실제 Moodle 계정과 충돌하기 어려운 테스트 전용 ID입니다.
// 이 계정은 외부 서버에 전송되지 않으며, 아래 DebugBackend에서만 처리됩니다.
const DEBUG_BACKEND_ENABLED = true;
const DEBUG_USERNAME = "0000000000";
const DEBUG_USERNAME_ALIAS = "debug";
const DEBUG_TOKEN_PREFIX = "JJFK_DEBUG::";
const DEBUG_SESSION_KEY = "jjfk-debug-session-v1";

// 디버그 모드에서는 서버 polling을 빠르게 관찰할 수 있도록 주기를 단축합니다.
// 실제 Moodle 로그인에서는 NETWORK_REFRESH_INTERVAL_MS(60초)가 그대로 사용됩니다.
const DEBUG_REFRESH_INTERVALS_MS = Object.freeze({
  normal: 15_000,
  massive: 15_000,
  deadline: 10_000,
  changes: 8_000,
  slow: 12_000,
  flaky: 10_000,
  empty: 15_000,
  malformed: 15_000,
  apierror: 15_000
});

const MAX_FUTURE_DAYS = 16;
const MAX_PAST_MS = 86_400_000;

// =========================
// STATE
// =========================
const State = {
  token: null,

  // 서버에서 받은 전체 정규화 데이터
  allData: [],

  // 현재 화면에 표시 중인 필터/정렬 데이터
  data: [],

  // setInterval 대신 재귀 setTimeout을 사용합니다.
  // iOS에서 긴 작업 뒤 주기가 겹치는 문제를 피할 수 있습니다.
  refreshTimer: null,
  clockTimer: null,

  loading: false,
  initialized: false,
  lastFetchAt: 0,
  lastReconcileAt: 0
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
// DEBUG BACKEND
// =========================
// 목적:
// - 별도 test-data.js 없이 실제 로그인 -> token -> assignments -> normalize
//   -> filter -> render -> polling 흐름을 그대로 검증합니다.
// - 디버그 토큰은 Moodle로 절대 전송되지 않습니다.
// - 모든 데이터는 결정적(deterministic)으로 생성되어 새로고침 전후 비교가 쉽습니다.
const DebugBackend = {
  scenarios: Object.freeze([
    "normal",
    "massive",
    "deadline",
    "changes",
    "slow",
    "flaky",
    "empty",
    "malformed",
    "apierror"
  ]),

  isDebugUsername(username) {
    if (!DEBUG_BACKEND_ENABLED) return false;
    const value = String(username ?? "").trim().toLowerCase();
    return value === DEBUG_USERNAME || value === DEBUG_USERNAME_ALIAS;
  },

  isDebugToken(token) {
    return (
      DEBUG_BACKEND_ENABLED &&
      typeof token === "string" &&
      token.startsWith(DEBUG_TOKEN_PREFIX)
    );
  },

  scenarioFromToken(token) {
    if (!this.isDebugToken(token)) return null;

    const scenario = token.slice(DEBUG_TOKEN_PREFIX.length).trim().toLowerCase();
    return this.scenarios.includes(scenario) ? scenario : null;
  },

  tokenForScenario(scenario) {
    return `${DEBUG_TOKEN_PREFIX}${scenario}`;
  },

  getSession() {
    const session = Store.get(DEBUG_SESSION_KEY);

    if (!session || typeof session !== "object") return null;
    if (!this.scenarios.includes(session.scenario)) return null;
    if (!Number.isFinite(Number(session.startedAt))) return null;
    if (!Number.isFinite(Number(session.requestCount))) return null;

    return {
      scenario: session.scenario,
      startedAt: Number(session.startedAt),
      requestCount: Number(session.requestCount),
      lastRequestAt: Number(session.lastRequestAt) || 0,
      lastResult: String(session.lastResult || "idle")
    };
  },

  setSession(session) {
    Store.set(DEBUG_SESSION_KEY, session);
  },

  clearSession() {
    Store.remove(DEBUG_SESSION_KEY);
  },

  ensureSession(token) {
    const scenario = this.scenarioFromToken(token);
    if (!scenario) return null;

    const existing = this.getSession();
    if (existing?.scenario === scenario) return existing;

    const session = {
      scenario,
      startedAt: Date.now(),
      requestCount: 0,
      lastRequestAt: 0,
      lastResult: "idle"
    };

    this.setSession(session);
    return session;
  },

  async login(username, password) {
    if (!this.isDebugUsername(username)) return null;

    const scenario = String(password ?? "").trim().toLowerCase();

    if (scenario === "help") {
      throw new Error(`DEBUG PW: ${this.scenarios.join(", ")}`);
    }

    // 로그인 오류 UI 자체를 확인하기 위한 예약 시나리오입니다.
    if (scenario === "loginfail") {
      await this.delay(900);
      throw new Error("DEBUG: 로그인 실패 응답을 에뮬레이션했습니다.");
    }

    if (!this.scenarios.includes(scenario)) {
      throw new Error(
        `DEBUG 비밀번호(시나리오)가 올바르지 않습니다. ` +
        `PW를 help로 입력하면 목록을 확인할 수 있습니다.`
      );
    }

    await this.delay(180);

    const session = {
      scenario,
      startedAt: Date.now(),
      requestCount: 0,
      lastRequestAt: 0,
      lastResult: "login-ok"
    };

    this.setSession(session);

    // 실제 token.php와 동일하게 token 필드가 있는 응답을 흉내냅니다.
    return {
      token: this.tokenForScenario(scenario),
      privatetoken: null
    };
  },

  async fetchAssignments(token) {
    const scenario = this.scenarioFromToken(token);
    if (!scenario) {
      throw new Error("DEBUG: 유효하지 않은 디버그 토큰입니다.");
    }

    let session = this.ensureSession(token);
    if (!session) {
      throw new Error("DEBUG: 디버그 세션을 만들 수 없습니다.");
    }

    session.requestCount += 1;
    session.lastRequestAt = Date.now();
    session.lastResult = "request";
    this.setSession(session);

    const requestNo = session.requestCount;

    try {
      if (scenario === "slow") {
        await this.delay(6_500);
      } else {
        await this.delay(220);
      }

      if (scenario === "flaky" && requestNo % 4 === 0) {
        throw new Error(`DEBUG: simulated network failure (#${requestNo})`);
      }

      if (scenario === "apierror") {
        session.lastResult = "api-error";
        this.setSession(session);

        // Moodle REST API가 세션/토큰 오류를 반환하는 형태를 흉내냅니다.
        return {
          exception: "moodle_exception",
          errorcode: "invalidtoken",
          message: "DEBUG: Invalid token - token not found"
        };
      }

      let response;

      switch (scenario) {
        case "massive":
          response = this.buildMassiveResponse(session);
          break;
        case "deadline":
          response = this.buildDeadlineResponse(session);
          break;
        case "changes":
          response = this.buildChangingResponse(session);
          break;
        case "empty":
          response = { courses: [] };
          break;
        case "malformed":
          response = this.buildMalformedResponse(session);
          break;
        case "slow":
        case "flaky":
        case "normal":
        default:
          response = this.buildNormalResponse(session);
          break;
      }

      session.lastResult = "ok";
      this.setSession(session);
      return response;
    } catch (error) {
      session.lastResult = "failed";
      this.setSession(session);
      throw error;
    }
  },

  getRefreshInterval(token) {
    const scenario = this.scenarioFromToken(token);
    if (!scenario) return NETWORK_REFRESH_INTERVAL_MS;
    return DEBUG_REFRESH_INTERVALS_MS[scenario] ?? 15_000;
  },

  getStatus(token) {
    const scenario = this.scenarioFromToken(token);
    if (!scenario) return null;

    const session = this.ensureSession(token);
    if (!session) return null;

    return {
      scenario,
      requestCount: session.requestCount,
      lastRequestAt: session.lastRequestAt,
      lastResult: session.lastResult
    };
  },

  delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, Math.max(0, ms)));
  },

  unixFromMs(ms) {
    return Math.floor(ms / 1000);
  },

  // startedAt을 기준으로 생성하므로 polling 때마다 마감시간이 흔들리지 않습니다.
  createAssignment({ id, name, dueMs }) {
    return {
      id,
      name,
      duedate: this.unixFromMs(dueMs)
    };
  },

  buildNormalResponse(session, options = {}) {
    const base = session.startedAt;
    const courseCount = options.courseCount ?? 8;
    const perCourse = options.perCourse ?? 7;

    const courseNames = [
      "인공지능수학기초",
      "데이터마이닝",
      "확률과통계",
      "파이썬프로그래밍",
      "인공지능개론",
      "컴퓨터공학개론",
      "영어회화 II",
      "대학글쓰기",
      "AI 응용 프로젝트",
      "캡스톤디자인",
      "컴퓨터비전",
      "머신러닝실습",
      "자료구조",
      "디지털논리"
    ];

    const assignmentNames = [
      "주차별 개념 정리 및 연습문제",
      "실습 결과 보고서 제출",
      "데이터 전처리 실습 과제",
      "발표 자료 초안 제출",
      "Python / OpenCV 실습 코드",
      "팀 프로젝트 개인 진행 내용",
      "온라인 퀴즈 및 오답 정리",
      "중간 프로젝트 제안서",
      "강의 내용 요약 및 질문 작성"
    ];

    const dueOffsets = [
      -25 * 60_000,
      38 * 60_000,
      2 * 3_600_000 + 17 * 60_000,
      9 * 3_600_000,
      22 * 3_600_000,
      1 * 86_400_000 + 5 * 3_600_000,
      2 * 86_400_000 + 18 * 3_600_000,
      4 * 86_400_000,
      7 * 86_400_000 + 11 * 3_600_000,
      12 * 86_400_000,
      15 * 86_400_000 + 3 * 3_600_000
    ];

    const courses = [];

    for (let c = 0; c < courseCount; c += 1) {
      const assignments = [];

      for (let a = 0; a < perCourse; a += 1) {
        const dueOffset =
          dueOffsets[(c * 3 + a) % dueOffsets.length] +
          c * 9 * 60_000 +
          a * 4 * 60_000;

        const longSuffix =
          a === 4
            ? " — 세부 요구사항과 파일명 규칙을 확인한 뒤 최종 파일을 업로드하세요"
            : "";

        assignments.push(
          this.createAssignment({
            id: 100_000 + c * 100 + a,
            name:
              assignmentNames[(c + a * 2) % assignmentNames.length] +
              longSuffix,
            dueMs: base + dueOffset
          })
        );
      }

      courses.push({
        id: 70_000 + c,
        fullname: courseNames[c % courseNames.length],
        assignments
      });
    }

    return { courses };
  },

  buildMassiveResponse(session) {
    // 18과목 x 20과제 = 360개. 필터 이후에도 충분한 양이 남습니다.
    return this.buildNormalResponse(session, {
      courseCount: 18,
      perCourse: 20
    });
  },

  buildDeadlineResponse(session) {
    const base = session.startedAt;
    const offsets = [
      -10 * 60_000,
      35 * 1000,
      2 * 60_000 + 10 * 1000,
      15 * 60_000,
      59 * 60_000,
      2 * 3_600_000 + 59 * 60_000,
      3 * 3_600_000 + 60_000,
      23 * 3_600_000 + 59 * 60_000,
      2 * 86_400_000 + 23 * 3_600_000,
      3 * 86_400_000 + 60_000,
      15 * 86_400_000
    ];

    return {
      courses: [
        {
          id: 88_001,
          fullname: "DEBUG · 마감 경계 테스트",
          assignments: offsets.map((offset, index) =>
            this.createAssignment({
              id: 880_100 + index,
              name: `마감 경계 테스트 ${String(index + 1).padStart(2, "0")}`,
              dueMs: base + offset
            })
          )
        }
      ]
    };
  },

  buildChangingResponse(session) {
    const response = this.buildNormalResponse(session, {
      courseCount: 6,
      perCourse: 5
    });

    const n = session.requestCount;
    const base = session.startedAt;

    // #3: 새 과제가 서버에 생김
    if (n >= 3) {
      response.courses[0].assignments.push(
        this.createAssignment({
          id: 199_001,
          name: "[서버 변경] 새로 추가된 과제",
          dueMs: base + 3 * 3_600_000 + 15 * 60_000
        })
      );
    }

    // #4: 기존 과제의 마감시간이 연장됨
    if (n >= 4 && response.courses[0]?.assignments[0]) {
      response.courses[0].assignments[0].duedate = this.unixFromMs(
        base + 6 * 3_600_000 + 30 * 60_000
      );
    }

    // #5: 과제 하나가 서버 목록에서 사라짐
    if (n >= 5 && response.courses[1]?.assignments?.length > 1) {
      response.courses[1].assignments.splice(1, 1);
    }

    // #6: 새로운 과목 자체가 추가됨
    if (n >= 6) {
      response.courses.push({
        id: 79_999,
        fullname: "[서버 변경] 새 강좌",
        assignments: [
          this.createAssignment({
            id: 299_001,
            name: "새 강좌 첫 번째 과제",
            dueMs: base + 11 * 3_600_000
          }),
          this.createAssignment({
            id: 299_002,
            name: "새 강좌 두 번째 과제",
            dueMs: base + 2 * 86_400_000 + 4 * 3_600_000
          })
        ]
      });
    }

    // #7: ID와 마감은 그대로 두고 제목만 변경.
    // render signature가 title 변경까지 감지하는지 확인합니다.
    if (n >= 7 && response.courses[2]?.assignments[0]) {
      response.courses[2].assignments[0].name =
        "[서버 변경] 제목이 수정된 기존 과제";
    }

    return response;
  },

  buildMalformedResponse(session) {
    return {
      courses: [
        null,
        {
          id: 91_001,
          fullname: "DEBUG · 일부 손상 데이터",
          assignments: [
            { id: 1, name: "duedate 누락" },
            { id: 2, name: "잘못된 duedate", duedate: "not-a-number" },
            this.createAssignment({
              id: 3,
              name: "정상 레코드 1개",
              dueMs: session.startedAt + 5 * 3_600_000
            })
          ]
        },
        {
          id: 91_002,
          fullname: "assignments가 배열이 아닌 강좌",
          assignments: "broken"
        }
      ]
    };
  }
};

function getNetworkRefreshIntervalMs() {
  return DebugBackend.getRefreshInterval(State.token);
}

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
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

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
    window.clearTimeout(timeout);
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

    const debugLogin = await DebugBackend.login(cleanUsername, cleanPassword);

    if (debugLogin?.token) {
      Store.set("token", debugLogin.token);
      State.token = debugLogin.token;
      return debugLogin.token;
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
    DebugBackend.clearSession();

    State.token = null;
    State.allData = [];
    State.data = [];
    State.lastFetchAt = 0;
    State.lastReconcileAt = 0;

    App.stopSchedulers();
    UI.renderLogin();
  }
};

// =========================
// API
// =========================
const API = {
  async fetchAssignments(token) {
    if (DebugBackend.isDebugToken(token)) {
      return await DebugBackend.fetchAssignments(token);
    }

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
    const safeMs = Math.max(0, ms);
    const d = Math.floor(safeMs / 86_400_000);
    const h = Math.floor((safeMs % 86_400_000) / 3_600_000);
    const m = Math.floor((safeMs % 3_600_000) / 60_000);

    return `${d}일 ${h}시간 ${m}분 남음`;
  },

  formatPassed(ms) {
    const safeMs = Math.max(0, ms);
    const h = Math.floor(safeMs / 3_600_000);
    const m = Math.floor((safeMs % 3_600_000) / 60_000);

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
  appSubtitle: null,

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
    this.appSubtitle = document.querySelector(".app-subtitle");
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
        this.updateDebugIndicator();

        if (this.loginPw) this.loginPw.value = "";

        const loaded = await App.load({ showLoading: true });
        if (loaded) App.startSchedulers();
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

    window.requestAnimationFrame(() => {
      try {
        this.loginId?.focus({ preventScroll: true });
      } catch {
        this.loginId?.focus();
      }
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
        const deadline = Number(assignment.deadline);

        return `
          <article class="assignment-row" data-assignment-id="${escapeHTML(assignment.id)}">
            <div class="assignment-main">
              <div class="assignment-title">${escapeHTML(assignment.title)}</div>
              <div class="assignment-deadline">마감 ${formatDeadline(deadline)}</div>
            </div>
            <div
              class="status ${status.color}"
              data-deadline="${deadline}"
            >${escapeHTML(status.text)}</div>
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

  // 서버 요청 없이 현재 DOM의 남은 시간만 갱신합니다.
  updateCountdowns() {
    if (!this.appView || !this.dashboardLayer?.classList.contains("active")) {
      return;
    }

    const elements = this.appView.querySelectorAll(".status[data-deadline]");

    elements.forEach(element => {
      const deadline = Number(element.dataset.deadline);
      if (!Number.isFinite(deadline)) return;

      const status = Logic.calcStatus(deadline);

      element.textContent = status.text;
      element.classList.remove("green", "orange", "red");
      element.classList.add(status.color);
    });
  },

  updateDebugIndicator() {
    if (!this.appSubtitle) return;

    const status = DebugBackend.getStatus(State.token);

    if (!status) {
      this.appSubtitle.textContent = "만든놈:daxun";
      return;
    }

    let suffix = `DEBUG ${status.scenario} · sync #${status.requestCount}`;

    if (status.lastResult === "failed") suffix += " · FAIL";
    if (status.lastResult === "api-error") suffix += " · API ERROR";

    if (status.lastRequestAt > 0) {
      const time = new Date(status.lastRequestAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      suffix += ` · ${time}`;
    }

    this.appSubtitle.textContent = suffix;
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

    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          "./service-worker.js",
          { scope: "./" }
        );

        // 새 SW가 있는지만 확인합니다.
        // v4의 controllerchange 강제 reload는 제거했습니다.
        // 실행 중인 화면을 갑자기 재로드시키지 않습니다.
        registration.update().catch(() => {});
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

    if (DebugBackend.isDebugToken(State.token)) {
      DebugBackend.ensureSession(State.token);
      UI.updateDebugIndicator();
    }

    if (!State.token) {
      UI.renderLogin();
      return;
    }

    UI.renderLoading();

    const loaded = await this.load({ showLoading: false });

    if (loaded && State.token) {
      this.startSchedulers();
    }

    this.bindResumeEvents();
  },

  async load({ showLoading = false, silent = false } = {}) {
    if (State.loading || !State.token) return false;

    State.loading = true;

    if (showLoading) {
      UI.renderLoading();
    }

    try {
      const raw = await API.fetchAssignments(State.token);
      UI.updateDebugIndicator();

      if (raw?.errorcode || raw?.exception) {
        Store.remove("token");
        DebugBackend.clearSession();
        State.token = null;
        State.allData = [];
        State.data = [];
        this.stopSchedulers();

        UI.renderLogin();
        UI.setAuthError("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");

        return false;
      }

      State.allData = Data.normalize(raw);
      State.lastFetchAt = Date.now();

      this.reconcileLocalData({ forceRender: true });

      return true;
    } catch (error) {
      console.error("[App.load]", error);
      UI.updateDebugIndicator();

      const message =
        error?.name === "AbortError"
          ? "서버 응답 시간이 초과되었습니다."
          : "과제 정보를 불러오지 못했습니다. 네트워크를 확인해 주세요.";

      // 네트워크가 실패해도 기존 데이터의 카운트다운은 계속 유지합니다.
      if (State.allData.length > 0 || State.data.length > 0) {
        this.reconcileLocalData({ forceRender: State.data.length === 0 });
        UI.updateCountdowns();

        if (!silent) UI.toast(message);
      } else {
        UI.renderLogin();
        UI.setAuthError(message);
      }

      return false;
    } finally {
      State.loading = false;
    }
  },

  reconcileLocalData({ forceRender = false } = {}) {
    if (!Array.isArray(State.allData)) return;

    const nextData = Data.sort(Filter.apply(State.allData));
    State.lastReconcileAt = Date.now();

    // 구조 변화 확인용 가벼운 signature.
    // 구조가 같으면 전체 DOM 재생성을 피하고 상태 텍스트만 갱신합니다.
    const makeSignature = data => data
      .map(course =>
        `${course.courseName}:${course.assignments
          .map(a => `${a.id}@${a.deadline}@${a.title}`)
          .join(",")}`
      )
      .join("|");

    const changed = makeSignature(State.data) !== makeSignature(nextData);
    State.data = nextData;

    if (forceRender || changed) {
      UI.renderDashboard(State.data);
    } else {
      UI.updateCountdowns();
    }
  },

  startSchedulers() {
    this.stopSchedulers();

    this.scheduleClockTick(0);
    this.scheduleNetworkRefresh(getNetworkRefreshIntervalMs());
  },

  stopSchedulers() {
    if (State.refreshTimer !== null) {
      window.clearTimeout(State.refreshTimer);
      State.refreshTimer = null;
    }

    if (State.clockTimer !== null) {
      window.clearTimeout(State.clockTimer);
      State.clockTimer = null;
    }
  },

  scheduleClockTick(delay = CLOCK_TICK_INTERVAL_MS) {
    if (!State.token) return;

    if (State.clockTimer !== null) {
      window.clearTimeout(State.clockTimer);
    }

    State.clockTimer = window.setTimeout(() => {
      State.clockTimer = null;

      if (State.token && document.visibilityState !== "hidden") {
        UI.updateCountdowns();

        if (Date.now() - State.lastReconcileAt >= LOCAL_RECONCILE_INTERVAL_MS) {
          this.reconcileLocalData();
        }
      }

      this.scheduleClockTick(CLOCK_TICK_INTERVAL_MS);
    }, Math.max(0, delay));
  },

  scheduleNetworkRefresh(delay = getNetworkRefreshIntervalMs()) {
    if (!State.token) return;

    if (State.refreshTimer !== null) {
      window.clearTimeout(State.refreshTimer);
    }

    State.refreshTimer = window.setTimeout(async () => {
      State.refreshTimer = null;

      if (State.token && document.visibilityState !== "hidden") {
        // 완료 후 다음 주기를 예약하므로 느린 요청이 겹치지 않습니다.
        await this.load({ showLoading: false, silent: true });
      }

      this.scheduleNetworkRefresh(getNetworkRefreshIntervalMs());
    }, Math.max(0, delay));
  },

  bindResumeEvents() {
    const resume = () => {
      if (!State.token) return;

      // iOS가 setTimeout을 정지시켰다가 앱을 되살린 경우 즉시 보정합니다.
      UI.updateCountdowns();
      this.reconcileLocalData();

      const stale = Date.now() - State.lastFetchAt >= getNetworkRefreshIntervalMs();

      if (stale && !State.loading) {
        this.load({ showLoading: false, silent: true });
      }

      // iOS에서 타이머 자체가 유실된 상황도 다시 살립니다.
      if (State.clockTimer === null) {
        this.scheduleClockTick(CLOCK_TICK_INTERVAL_MS);
      }

      if (State.refreshTimer === null) {
        this.scheduleNetworkRefresh(getNetworkRefreshIntervalMs());
      }
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resume();
    });

    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
  }
};

// =========================
// BOOT
// =========================
window.addEventListener("DOMContentLoaded", () => {
  App.init().catch(error => {
    console.error("[Boot]", error);

    try {
      UI.initRefs();
      UI.renderLogin();
      UI.setAuthError("앱 초기화 중 오류가 발생했습니다. 다시 실행해 주세요.");
    } catch (fallbackError) {
      console.error("[Boot fallback]", fallbackError);
    }
  });
});
