# AgentCircuit — Gemini + Ollama AI Decision Tracking

기존 Control Tower의 **AI Decisions**는 구형 Ollama 판단 API에서 기록된 `AI_DECISION` 활동만 세어 새 Gemini/Ollama 플래너의 결정은 증가하지 않았습니다. 이 패치는 새로운 모델의 **성공적으로 검증된 작업 계획**을 Credit Agent의 서명으로 서버에 기록합니다.

## 변경 사항

- 새 서버 API: `app/api/control/ai-plan/route.ts`. **서명과 Credit Agent 역할을 검증**하고, 정해진 에이전트/작업/단계만 수용. 일반 `/api/control/activity`의 AI_DECISION 직접 쓰기 금지는 유지.
- 새 Python reporter: `fetch_agents/ai_plan_reporter.py`. 모델의 검증된 판단을 별도 API에 보내며, 로깅 장애가 실제 에이전트 실행이나 AgentCircuit 접근 정책을 변경하지 않음.
- 최소 수정: `fetch_agents/ai_coordinated_agents.py`, `app/control/CompactActivityMonitor.tsx`. 기존 파일 자동 백업.
- UI의 AI Decisions가 새 Gemini/Ollama 판단도 집계하며, 최신 결정의 모델, 다음 에이전트, 정확한 작업과 이유, 실제 정책 이벤트가 있으면 결과를 보여줌.
- **정책 결과는 실제 실행 이벤트로 확인될 때만 표시**하고, 없으면 `Awaiting verified access result`. x402는 `DRY RUN / NO PAYMENT`로 표시. 기존 서명 검증, CRS 캐시, x402 결제 정책을 변경하지 않음.

## Windows PowerShell 적용

1. Control Tower에서 **Stop**을 누르세요.
2. 이 ZIP 파일을 `D:\Downloads\AgentCurcuit-main\AgentCurcuit-main` 에 저장하세요.
3. 새 PowerShell에서:

```powershell
cd "D:\Downloads\AgentCurcuit-main\AgentCurcuit-main"
Expand-Archive -Path .\AgentCircuit_AI_Decision_Tracking.zip -DestinationPath . -Force
.\.venv-fetch\Scripts\python.exe -B .\tools\patch_ai_decisions.py
```

성공시 `AI DECISION TRACKING PATCH APPLIED`가 나타납니다. 기존 `.env.local`, 모델 선택, API 키, 기존 보안 설정을 수정하지 않습니다. 스크립트에서 예상과 다른 버전이면 **파일을 변경하지 않고 중단**합니다.

4. **Next.js 서버를 재시작**하세요. Next.js 실행 터미널에서 Ctrl+C, 이어서:

```powershell
npm.cmd run dev
```

5. Control Tower http://localhost:3000/control 에서 Gemini 또는 Ollama를 선택해 실행하세요.

## 확인할 로그

```text
AI PROVIDER SELECTED: OLLAMA
CREDIT CHECK COMPLETE
AI DECISION RECORDED | OLLAMA | after_credit | fraud / review_fraud
OLLAMA AI SELECTED: fraud
```

이후 Fraud 결과를 받고 다음 작업을 선택하면 AI DECISION 기록이 한 번 더 추가됩니다. **모델 응답이 반환되지 않았거나 계획 검증이 실패했다면 숫자가 증가하지 않는 것이 정상**입니다. API 기록이 실패하면 `AI decision reporting failed: HTTP ...` 경고가 뜹니다.

서버 상태 확인:

```powershell
Invoke-RestMethod http://localhost:3000/api/control/activity | Select-Object -ExpandProperty activity | Select-Object -First 5 type,model,choice,detail
```

## 기존 19 카운터 주의

AI Decisions의 숫자는 `/api/control/activity`가 **현재 메모리에 유지하는 최근 활동(최대 200개) 중 AI_DECISION 수**입니다. 영구 누적 카운터는 아닙니다. Next.js 서버 재시작이나 활동 보존 한도에 따라 숫자가 초기화되거나 예전 기록이 밀려날 수 있습니다. 따라서 이전 `19`가 유지되는지는 보장하지 않습니다.

## 롤백

Control Tower에서 Stop을 누르고:

```powershell
Copy-Item .\fetch_agents\ai_coordinated_agents.py.before-ai-decision-tracking.bak .\fetch_agents\ai_coordinated_agents.py -Force
Copy-Item .\app\control\CompactActivityMonitor.tsx.before-ai-decision-tracking.bak .\app\control\CompactActivityMonitor.tsx -Force
```

새로 추가된 `fetch_agents/ai_plan_reporter.py`와 `app/api/control/ai-plan/route.ts`는 이전 코드에서 사용하지 않아 남아 있어도 실행에 영향을 주지 않습니다.

## 범위와 주의사항

- 서명된 Credit Agent의 보고로 기록하므로 일반 브라우저/다른 역할의 에이전트는 임의의 AI Decision을 만들 수 없습니다. 이 기록이 모델 추론의 암호학적 증명은 아닙니다.
- 이 패치는 새 AI task planner의 결정을 기록합니다. 구형 underwriting decision API의 기존 기록도 그대로 보존합니다.
- `ALLOW / REUSE / BLOCK`는 각 정책 실행의 결과이며, AI가 허용한 것을 의미하지 않습니다.
- 입력을 바꾸거나 오류를 억지로 무시하는 기능이 아닙니다. 첫 모델 응답이 돌아오지 않은 상태에서는 카운트가 증가하지 않습니다.
