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
