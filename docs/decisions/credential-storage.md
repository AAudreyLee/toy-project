# 외부 접근 권한 보관

## Decisions

- 사용자가 서비스에 연결하는 외부 접근 권한(LLM API 키, GitHub OAuth 접근 권한, Vercel 토큰)은 사용자의 브라우저에만 보관합니다. 서비스 서버는 요청 안에서만 쓰고 저장하거나 로그에 남기지 않습니다.
- GitHub는 OAuth로 연결합니다(2026-11-19 사용자 결정). OAuth 코드 교환처럼 서버가 한 번 거쳐야 하는 경우에도, 서버는 받은 접근 권한을 응답으로 브라우저에 넘기고 끝냅니다.
- Vercel은 사용자가 Vercel에서 발급한 토큰을 직접 붙여 넣어 연결합니다(2026-11-19 사용자 결정). Vercel의 OAuth(Sign in with Vercel)가 프로젝트·배포 API 권한을 일반에 공개하기 전까지의 결정입니다.
- 만들어진 시스템의 데이터를 서버에 저장하기 위한 Supabase 액세스 토큰도 Vercel 토큰처럼 사용자가 직접 붙여 넣고 브라우저에만 보관합니다([server-data-storage](server-data-storage.md), 2026-11-19 사용자 결정).
- OAuth로 받은 접근 권한은 브라우저의 스크립트가 읽을 수 없는 방식(`HttpOnly` 쿠키 등)으로 두는 것을 우선합니다. 서버가 쿠키를 설정할 뿐 따로 저장하지 않습니다.

## Boundaries

- 브라우저 데이터를 지우면 다시 연결해야 합니다. 다른 기기나 다른 브라우저로는 이어지지 않습니다.
- OAuth 앱 등록과 client secret은 서비스 운영자 소유의 서버 환경 변수입니다. 이는 인증 연결에만 쓰며, [deployment-ownership](deployment-ownership.md)이 금지한 "운영자 계정으로 사용자 시스템을 대신 배포하는 것"이 아닙니다.
- 어떤 권한을 받을지(GitHub OAuth scope, Vercel 토큰의 범위)는 이 결정이 정하지 않습니다.
- 사용자가 직접 붙여 넣는 값(LLM API 키, Vercel 토큰)을 브라우저 안에서 어떤 저장소에 둘지는 이 결정이 정하지 않습니다.

## Why

서비스에는 로그인과 서버 저장소가 없고 이를 다음 결과로 미뤘습니다([guided-planning-to-spec](../specs/guided-planning-to-spec/spec.md)). 사용자 자원은 사용자가 소유하고 부담한다는 방향([deployment-ownership](deployment-ownership.md), [llm-usage-billing](llm-usage-billing.md))과도 맞춥니다.

GitHub는 비개발자에게 토큰 발급이 큰 허들이라 사용자가 OAuth를 택했습니다. Vercel은 같은 이유로 OAuth를 택했지만, 공식 문서([Scopes and Permissions](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions), 2026-02-26 갱신)에서 프로젝트와 배포를 다루는 API 권한이 비공개 베타이고, 참여 방법과 일정이 공개되어 있지 않아([커뮤니티 문의](https://community.vercel.com/t/how-to-get-access-to-sign-in-with-vercel-api-permissions-private-beta/44972), 2026-07-01과 2026-10-25, 직원 답변 없음) 지금 쓸 수 없다고 판단해 토큰 직접 입력으로 바꿨습니다. OAuth 접근 권한을 스크립트가 읽을 수 없게 두려는 것은 Vercel [토큰 문서](https://vercel.com/docs/sign-in-with-vercel/tokens)가 토큰을 클라이언트 쪽에 노출하지 말고 `HttpOnly` 쿠키나 암호화된 저장소에 두라고 안내하는 것을 따릅니다.

## Reconsider when

- 로그인이 들어오는 결과를 shape할 때
- Vercel이 프로젝트·배포 API 권한을 일반에 공개해 Vercel도 OAuth로 연결할 수 있게 될 때
- 토큰 만료나 브라우저 데이터 삭제로 연결을 다시 요청하는 일이 잦거나, 토큰 발급 단계에서 비개발자가 이탈한다는 실제 사용 근거가 나올 때

## Still-rejected alternatives

- 서버에 접근 권한 저장 — 로그인, 여러 기기 동기화, 서버 저장소가 함께 필요해 범위를 크게 늘리고, 서버가 사용자 계정의 권한을 쥐게 됩니다.
- GitHub 토큰 직접 입력 — 서버 저장은 피하지만 비개발자에게 토큰 발급이라는 허들을 줍니다. 사용자가 OAuth를 택했습니다.
- Vercel을 OAuth로 연결(지금) — 필요한 API 권한이 비공개 베타여서 구현을 시작할 수 없고 승인 일정도 알 수 없습니다.
