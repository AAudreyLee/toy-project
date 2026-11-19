# 생성 코드 검사가 `process.env` 단독 사용을 놓침

- 증상: `validateGenerated`의 환경 변수 규칙이 `process.env.이름`과 `process.env[` 형태만 잡아서, `const e = process.env;`처럼 단독으로 쓰면 통과합니다. 서버 저장 이전에는 `process.env` 전체를 막았으므로 규칙이 느슨해졌습니다.
- 근거: code-review(low) 지적, `features/guided-planning/delivery/generate.ts`의 환경 변수 검사 줄.
- 의심 원인: 서버 코드에서 `DATABASE_URL`만 허용하려고 변수 이름을 뽑는 정규식으로 바꾸면서 단독 사용 경우를 빠뜨렸습니다.
- 시도한 것: 없음. 화면 코드의 환경 변수는 `NEXT_PUBLIC_`이 아니면 브라우저로 내려가지 않아 비밀 노출 위험은 낮다고 판단했습니다.
- 다음 단계: `/process\.env(?!\.DATABASE_URL\b)/`처럼 허용 이름 외 모든 `process.env` 사용을 잡도록 바꾸고 테스트를 추가합니다.
