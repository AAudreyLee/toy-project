# 외부 접근 권한 보관

## Decisions

- 사용자가 서비스에 연결하는 외부 접근 권한(LLM API 키, GitHub·Vercel OAuth 토큰)은 사용자의 브라우저에만 보관합니다. 서비스 서버는 요청 안에서만 쓰고 저장하거나 로그에 남기지 않습니다.
- OAuth 코드 교환처럼 서버가 한 번 거쳐야 하는 경우에도, 서버는 받은 토큰을 응답으로 브라우저에 넘기고 끝냅니다.
- 사용자가 GitHub와 Vercel을 연결하는 방식은 OAuth입니다(2026-11-19 사용자 결정).

## Boundaries

- 브라우저 데이터를 지우면 다시 연결해야 합니다. 다른 기기나 다른 브라우저로는 이어지지 않습니다.
- OAuth 앱 등록과 client secret은 서비스 운영자 소유의 서버 환경 변수입니다. 이는 인증 연결에만 쓰며, [deployment-ownership](deployment-ownership.md)이 금지한 "운영자 계정으로 사용자 시스템을 대신 배포하는 것"이 아닙니다.
- 어떤 권한을 받을지(OAuth scope와 Vercel API permission)는 이 결정이 정하지 않습니다.

## Why

서비스에는 로그인과 서버 저장소가 없고 이를 다음 결과로 미뤘습니다([guided-planning-to-spec](../specs/guided-planning-to-spec/spec.md)). 사용자 자원은 사용자가 소유하고 부담한다는 방향([deployment-ownership](deployment-ownership.md), [llm-usage-billing](llm-usage-billing.md))과도 맞춥니다. 처음 권고는 토큰을 직접 붙여 넣는 방식이었지만, 비개발자에게 토큰 발급은 큰 허들이어서 사용자가 OAuth를 택했습니다. 그 대신 서버가 토큰을 잠시 거치므로 "저장하지 않는다"는 규칙을 계약으로 못 박습니다.

## Reconsider when

- 로그인이 들어오는 결과를 shape할 때
- 토큰 만료나 브라우저 데이터 삭제로 연결을 다시 요청하는 일이 잦아 이탈한다는 실제 사용 근거가 나올 때

## Still-rejected alternatives

- 서버에 토큰 저장 — 로그인, 여러 기기 동기화, 서버 저장소가 함께 필요해 범위를 크게 늘리고, 서버가 사용자 계정의 권한을 쥐게 됩니다.
- 토큰 직접 입력 — 서버 저장은 피하지만 비개발자에게 토큰 발급이라는 허들을 줍니다. 사용자가 OAuth를 택했습니다.
