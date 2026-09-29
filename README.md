# 📚 Assignment Hub (PWA)
Moodle 기반 전주대학교의 과제 정보를 모바일 환경에서 빠르게 확인할 수 있는 PWA 웹앱입니다.
별도의 서버 없이 **클라이언트(JavaScript)만으로 동작**하며

```diff
- **향후 본 프로젝트의 무단 재배포를 금지합니다.**
```
---

## 🚀 주요 기능

* 🔐 Moodle 토큰 기반 로그인
* 📋 전체 과제 자동 조회 (API)
* ⏳ 마감 임박 / 종료 상태 자동 계산
* 🎯 16일 이내 과제만 필터링
* 📱 모바일 최적화 UI
* 📦 PWA 지원 (홈 화면 추가, 앱처럼 실행)
* 🔄 앱 실행 시 최신 과제 자동 반영

---

## 🧱 프로젝트 구조

```
.
├── index.html          # 메인 UI
├── style.css           # 스타일
├── app.js              # 핵심 로직
├── manifest.json       # PWA 설정
├── service-worker.js   # 캐싱 및 오프라인 처리
└── icons/              # 앱 아이콘
```

---

## ⚙️ 동작 방식

### 1. 로그인

* 사용자 ID / 비밀번호 입력
* Moodle `token.php` API 호출
* 토큰을 `localStorage`에 저장

### 2. 데이터 로드

* 저장된 토큰으로 과제 API 호출
* `mod_assign_get_assignments` 사용

### 3. 데이터 처리

* 과목별 과제 정리
* 마감일 기준 정렬
* 필터 조건 적용:

  * 16일 초과 과제 제외
  * 일정 이상 지난 과제 제외

### 4. 상태 계산

* 남은 시간 기준 색상 표시

  * 초록: 여유 있음
  * 주황: 마감 임박
  * 빨강: 마감 초과

### 5. UI 렌더링

* 과목별 카드 생성
* 과제 리스트 출력

---

## 🔗 사용 API

### 토큰 발급

```
https://cyber.jj.ac.kr/login/token.php
```

### 과제 조회

```
https://cyber.jj.ac.kr/webservice/rest/server.php
```

### 사용 함수

```
mod_assign_get_assignments
```

---


## 📱 PWA 사용 방법

1. 사이트 접속
2. 브라우저 메뉴 → "홈 화면에 추가"
3. 앱처럼 실행 가능

---

## 🔒 데이터 저장

* 토큰: `localStorage`
* 서버 저장 없음
* 모든 데이터는 클라이언트에서 처리

---

## ⚠️ 주의사항

* 계정 정보는 브라우저 내에서만 사용됨
* 공용 PC 사용 시 토큰 삭제 필요
* Moodle API 변경 시 동작 오류 발생 가능

---

## 🧠 설계 특징

* 서버 없이 동작하는 완전 프론트엔드 구조
* PWA 기반 모바일 앱 대체
* API 기반 실시간 데이터 반영
* 빠른 로딩과 단순한 UI 구조

---


## 📄 License

MIT License


## v4.4 debug keyword login

디버그 모드는 비밀번호가 아니라 학번(ID) 칸의 예약어로 선택합니다.

- `normal` / PW 빈칸: 기본 데이터
- `massive` / PW 빈칸: 대량 과제
- `deadline` / PW 빈칸: 마감 경계값
- `changes` / PW 빈칸: polling마다 추가/삭제/마감 변경
- `slow` / PW 빈칸: 느린 서버
- `flaky` / PW 빈칸: 주기적 네트워크 실패
- `empty` / PW 빈칸: 빈 목록
- `malformed` / PW 빈칸: 일부 손상 데이터
- `apierror` / PW 빈칸: Moodle API 오류
- `loginfail` / PW 빈칸: 로그인 오류 UI 테스트
- `help` / PW 빈칸: 예약어 목록 표시
- `debug`는 `normal`의 별칭입니다.

안전을 위해 예약어가 ID에 들어오면 비밀번호 자동완성 여부와 관계없이 Moodle 서버로 절대 전송하지 않습니다. 실제 Moodle 로그인은 숫자 학번 + 비밀번호 방식 그대로입니다.


## v4.5 - Elastic Edge / Pull to Refresh

- 긴 과제 목록: iOS의 네이티브 관성 스크롤과 끝단 탄성을 그대로 유지합니다.
- 짧은 과제 목록: 스크롤 높이가 화면보다 짧아도 위/아래 방향으로 탄성 이동합니다.
- 최상단에서 아래로 약 92 CSS px 이상 당긴 뒤 놓으면 Moodle assignments API를 즉시 다시 조회합니다.
- 자동 서버 동기화 주기와 별개로 수동 새로고침이 동작합니다.
- 자동 동기화가 이미 진행 중이면 요청을 겹치지 않고 종료 직후 수동 동기화를 1회 실행합니다.
- 새로고침 도중에는 indicator가 유지되고 성공/실패 결과를 짧게 표시합니다.
- 네트워크 갱신 후에는 자동 polling 타이머를 다시 예약합니다.
- 요청 중 로그아웃/토큰 변경이 발생하면 늦게 도착한 응답은 화면에 적용하지 않습니다.

디버그 백엔드는 기존과 동일합니다.

- ID `normal`, PW 빈칸: 일반 데이터
- ID `massive`: 대량 데이터
- ID `changes`: 서버 데이터 변경
- ID `slow`: 느린 서버
- ID `flaky`: 간헐적 실패
- ID `empty`: 빈 목록


## v4.6 deliberate refresh

- iOS 상태바 `theme-color`를 `#17181d`로 올려 상단이 지나치게 검게 보이던 문제를 완화했습니다.
- pull-to-refresh 결과 indicator를 top bar보다 높은 stacking layer로 올렸습니다.
- 새로고침은 34px dead-zone → 154px pull → 140ms 유지 → release의 2단계 의도 제스처로만 실행됩니다.
- 전체 pull 동작도 최소 320ms 이상이어야 하므로 우연한 빠른 overscroll은 새로고침으로 이어지지 않습니다.
- 업데이트 완료/실패 표시 시간을 700ms로 늘렸습니다.
