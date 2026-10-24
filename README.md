# AgentCircuit

**여러 AI 에이전트가 동시에 일해도, 금융 업무에서 중복 실행·예산 초과·권한 위반이 생기지 않게 막아 주는 실시간 통제 시스템.**
Cal Hacks 13.0 · CRS sponsor challenge 출품작입니다.

> 데이터는 전부 CRS **sandbox**의 가짜 사람(persona)입니다. 실제 개인정보는 한 건도 쓰지 않았습니다.

---

## 1. 한 줄로 설명하면?

학교 급식실을 떠올려 보세요.

- **요리사 3명** = AI 에이전트 (Credit, Fraud, Payment)
- **재료 가게** = CRS (신용정보를 파는 곳, 살 때마다 돈이 듦)
- **급식실 선생님** = **AgentCircuit**

요리사 3명이 똑같은 재료를 각자 사 오면 돈이 낭비됩니다.
선생님이 "그 재료는 방금 Credit 요리사가 사 왔어, 같이 써" 하고 정리해 주는 것. 이게 이 프로젝트입니다.

## 2. 어떤 문제를 푸나요?

AI 에이전트가 10개, 100개가 되면 각자는 똑똑해도 서로가 뭘 하는지 모릅니다.

| 문제 | 예시 |
|---|---|
| 중복 실행 | Credit, Fraud 에이전트가 같은 사람의 신용 리포트를 따로 조회 → 비용 2배 |
| 예산 초과 | 에이전트 15개가 동시에 "나 돈 쓸게" → 전체 예산 초과 |
| 권한 문제 | Payment 에이전트가 볼 필요 없는 원본 신용 파일에 접근 |

여기서 중요한 점: **"AI야, 이거 중복이니?"라고 물어보지 않습니다.**
작업마다 이름표(`credit_report:P01:experian`)를 붙이고, 예산은 쓰기 전에 먼저 예약하는 방식으로 **코드가 확실하게** 막습니다. AI는 가끔 틀리지만 자물쇠는 틀리지 않으니까요.

## 3. 지금 되는 것 / 아직 안 된 것

| 기능 | 상태 |
|---|---|
| CRS sandbox 실제 호출 (3개 bureau 신용 리포트) | ✅ 동작 |
| 중복 제거 (진행 중인 호출에 합류, 끝난 결과 재사용) | ✅ 동작 |
| 예산 예약 (동시 요청에도 초과 불가) | ✅ 동작 |
| 권한 통제 (에이전트별 접근 범위) | ✅ 동작 |
| 이벤트 로그와 실시간 대시보드 (`/control`) | ✅ 동작 |
| ASI:One 채팅 → 대장 → Credit 에이전트 → CRS 조회 (아래 11번 참고) | ✅ P17로 확인 |
| 충돌 감지 (P17처럼 bureau끼리 결과가 다른 경우) | 🔜 예정 |
| 사망 표시·동결 파일 처리와 실패 복구 (P14, P15) | 🔜 예정 |
| Fraud 에이전트용 CRS 제품 연결 (신원 확인, FraudFinder) | 🔜 예정 |

## 4. 직접 보기: 두 가지 시나리오

`/control` 화면에서 버튼 하나로 실행합니다. 실제 시험 결과입니다.

**시나리오 1. 같은 신청자(P01), 에이전트 3명이 동시에 조회**

| | 숫자 |
|---|---|
| 요청 | 9건 |
| **실제 CRS 호출** | **3회** |
| 재사용 | 3건 (Fraud가 Credit의 진행 중인 호출에 합류) |
| 차단 | 3건 (Payment는 신용 리포트 접근 권한 없음) |

**시나리오 2. 15건을 동시에 요청, 예산은 $10 (5건 분량)**

| | 숫자 |
|---|---|
| 요청 | 15건 |
| 실행 | 5건 |
| 차단 | 10건 |
| 지출 | 정확히 $10 (초과 없음) |

## 5. 직접 실행해 보기

필요한 것: Node.js 18 이상, CRS sandbox 계정 (Cal Hacks에서 CRS 팀이 발급).

```bash
# 1. 의존성 설치
npm install

# 2. 비밀번호 파일 만들기 (.env.local, git에 올라가지 않음)
cat > .env.local <<'EOF'
CRS_USERNAME="your-sandbox-username"
CRS_PASSWORD="your-sandbox-password"
EOF

# 3. 실행
npm run dev
```

> 비밀번호에 `#`이 있으면 **반드시 따옴표**로 감싸세요. 안 감싸면 `#` 뒤가 주석으로 잘려 로그인이 실패하고, 로그인을 여러 번 틀리면 계정이 잠깁니다.

그다음 브라우저에서:

| 주소 | 무엇이 보이나요 |
|---|---|
| `http://localhost:3000` | **CRS 확인 화면.** persona 버튼을 누르면 3개 bureau를 실제로 조회해 점수·파일 상태·오류·RequestID를 표로 보여줌 |
| `http://localhost:3000/control` | **컨트롤 타워.** 시나리오를 실행하고 호출/재사용/차단 숫자, 예산 막대, 이벤트 로그를 실시간으로 봄 |

## 6. 테스트 persona (CRS sandbox)

| ID | 이름 | 상황 | 3개 bureau 결과 |
|---|---|---|---|
| P01 | Margaret Okafor | 우량 고객 | 790 / 790 / 790 |
| P13 | Kayla Brennan | 가짜 신원 의심 | 640 ×3 (점수만 보면 평범) |
| P14 | Harold Pettigrew | 사망 표시 | 점수 없음, 오류 `E1200` |
| P15 | Nicole Farragut | TransUnion 동결 | TU 파일 없음(`CreditFreeze`) / 740 / 740 |
| P17 | Elena Castellanos | bureau끼리 의견 다름 | TU 760 / Equifax 파일 없음 / Experian 700 |

읽을 때 주의할 점 두 가지:

1. **HTTP 200이어도 실패일 수 있습니다.** P14는 200으로 응답하지만 본문의 `errorMessages`에 오류가 있습니다.
2. **오류가 없어도 데이터가 없을 수 있습니다.** P15의 TransUnion은 오류 없이 응답하지만 `NoFileReturnedCreditFreeze`라 파일이 없습니다. 그래서 `creditFileResultStatusType`도 함께 확인합니다.

## 7. 폴더 구조

```
app/
  page.tsx                  CRS 확인 화면
  control/page.tsx          컨트롤 타워 대시보드
  api/crs/credit/           CRS 신용 리포트 호출 (서버)
  api/control/scenario/     시나리오 실행 (서버)
  api/control/state/        대시보드용 상태 조회 (서버)
lib/
  crs/client.ts             CRS 통신 담당: 로그인 1회, 토큰 재사용, RequestID, errorMessages 검사
  crs/personas.ts           persona 요청 본문 (CRS MCP에서 받은 원문 그대로)
  control/circuit.ts        핵심 로직: 권한 → 중복 → 예산 예약 → 호출
  control/store.ts          진행 중 작업, 결과 보관함, 예산, 이벤트 로그 (메모리)
```

## 8. 책임 있게 쓰기 (Responsible)

- **가짜 데이터만** 씁니다. CRS sandbox의 persona 요청 본문을 그대로 사용합니다.
- **비밀번호는 서버에만** 있습니다. CRS 호출은 전부 서버 코드(`server-only`)에서 하고, 브라우저는 우리 API만 부릅니다.
- **로그인은 한 번만** 하고 토큰을 재사용합니다. 로그인 실패 후에는 재시도하지 않아 계정 잠금을 막습니다.
- **비용은 시뮬레이션**입니다. sandbox는 무료이고, 건당 $2는 예산 로직을 보여주기 위해 정한 가상 가격입니다. 화면에도 그렇게 표시합니다.
- **디버깅 가능**합니다. 모든 호출의 `RequestID`를 기록하므로 CRS의 `debug_request`로 실제 응답을 추적할 수 있습니다.

## 9. 알려진 한계

- 상태(보관함, 예산, 로그)는 **서버 메모리**에 있어서 서버를 재시작하면 사라집니다. 서버가 여러 대로 늘어나면 공유 저장소(DB 잠금)가 필요합니다.
- 서버 코드가 필요한 앱이라 **GitHub Pages(github.io) 같은 정적 호스팅에서는 동작하지 않습니다.** Vercel 같은 Next.js 호스팅이 필요합니다.
- 충돌 감지·실패 복구는 아직 구현 전입니다 (3번 표 참고).

## 10. 기술 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · CRS Credit API (sandbox)

## 11. ASI:One agents (Fetch.ai)

A Python [uAgents](https://pypi.org/project/uagents/) pair lives in [`agents/`](agents/). You can chat with the lead agent from ASI:One:

```
ASI:One chat  ->  AgentCircuit (lead, Agent Chat Protocol)  ->  Credit agent  ->  Next.js gateway  ->  CRS sandbox
```

- **Lead agent** (`agents/lead_agent.py`): runs as a local agent with an Agentverse Mailbox. It acknowledges every `ChatMessage`, accepts one allowed sandbox persona per request (P01, P13, P14, P15, P17), delegates to the Credit agent and replies in chat.
- **Credit agent** (`agents/credit_agent.py`): pulls TransUnion, Equifax and Experian for the persona. It holds no CRS credentials; it calls the existing `/api/crs/credit` route, which owns the credentials and the exact persona request bodies.
- Requests and results are matched by `task_id`. Timeouts, CRS errors, gateway failures, no-hit, freeze and deceased are reported as different outcomes.
- Replies are data summaries. They never approve, decline or call anyone a fraudster.

### Run it

```bash
npm run dev                                   # 1) CRS gateway on :3000 (needs .env.local)

cd agents                                     # first time only:
python3.13 -m venv .venv                      #   Python 3.10-3.13 (3.14 is not supported by uAgents yet)
.venv/bin/pip install -r requirements.txt
.venv/bin/python init_env.py                  #   writes agents/.env with fresh seeds; seeds are never printed

.venv/bin/python credit_agent.py              # 2) Credit agent on :8002
.venv/bin/python lead_agent.py                # 3) Lead agent on :8001 (Mailbox mode)
```

Then open the "Agent inspector" link printed by the lead agent, choose **Connect -> Mailbox**, and chat with the agent from its Agentverse profile: `Check credit for P17`.

Offline check without Agentverse: `LEAD_MAILBOX=false .venv/bin/python lead_agent.py`, then `.venv/bin/python dev_client.py "Check credit for P17"`.
Tests: `.venv/bin/python -m pytest -q`. All settings are listed in [`agents/.env.example`](agents/.env.example).

### Status

Verified: the full ASI:One chat -> lead -> Credit agent -> CRS sandbox -> chat round trip for P17, and local runs for P01, P14, P15, disallowed personas, gateway down, Credit agent down and timeouts.
Not done yet: the shared budget and de-duplication gate is not connected to this agent path, and nothing has been submitted to Devpost.

---

Cal Hacks 13.0 · Oct 23–25, 2026 · Palace of Fine Arts, San Francisco
