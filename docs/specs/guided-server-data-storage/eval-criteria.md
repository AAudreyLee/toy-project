# agent 구현 품질 eval 판정 기준

[spec.md](spec.md)의 "agent 구현 품질" 기준을 어떻게 채점하는지 적습니다. 사례는 [eval-cases.jsonl](eval-cases.jsonl)(새 사례 25개)과 앞선 결과의 [사례](../guided-implementation-to-deploy/eval-cases.jsonl)입니다. `split`이 `test`인 사례가 최종 판정용이고 `train`은 프롬프트를 다듬는 데 썼습니다. 새 사례의 `label`과 `reason`은 사람이 판단해 적었습니다.

실행기는 `.claude/hillclimb/guided-server-data-storage/run.ts`이며 앱의 실제 진입점(`handleDeliveryRequest`)을 Azure OpenAI 배포로 호출합니다. 판정은 코드로만 합니다.

## 지원 범위 세 갈래 판정 (목표 85% 이상, 앞선 결과의 회귀 사례는 90% 이상 유지)

- `supported`: 데이터베이스 없이 만들 수 있다(브라우저 저장소로 충분한 것 포함). 판정 결과가 `supported: true`이고 `needsDatabase: false`여야 맞습니다.
- `database`: 로그인 없이 모두가 같은 데이터를 보고 쓰는 공유 데이터라 서버 저장이 필요하다. `supported: true`이고 `needsDatabase: true`여야 맞습니다.
- `unsupported`: 알림·예약 실행·키가 필요한 외부 서비스·로그인과 사용자별 비공개 데이터가 필요해 막아야 한다. `supported: false`여야 맞습니다.

## 서버 저장 시스템 코드가 빌드됨 (목표 70% 이상)

`database` 사례 15개로 코드를 만들어 `next build`를 돌립니다. 빌드 실패 시 자동 수정을 최대 2번 시도하고 최종 결과로 판정합니다. 빌드에는 접속하지 않는 가짜 `DATABASE_URL`을 주입합니다(실제 배포에서는 연결된 데이터베이스의 값이 빌드에도 주입됩니다).

## 비밀 키 노출 없음

화면 코드(`app/page.tsx`, `components/`)에 `process.env`, `DATABASE_URL`, `@neondatabase`, `lib/` 가져오기가 있으면 빌드가 통과해도 실패로 셉니다. 생성 단계의 코드 검사(`validateGenerated`)가 같은 규칙으로 먼저 막고, eval은 최종 결과에서 한 번 더 확인합니다.
