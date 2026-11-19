#!/usr/bin/env bash
# 기능 검사: 타입 → 린트 → 단위/컴포넌트 테스트 → (선택) E2E.
# 사용: scripts/verify.sh [--e2e] [--staged]
#   --e2e     Playwright E2E까지 실행 (dev 서버를 자동으로 띄운다)
#   --staged  상호작용 커버리지 리포트를 스테이지된 파일로 한정
set -u
cd "$(dirname "$0")/.."

E2E=0; SCOPE="--changed"
for a in "$@"; do
  case "$a" in
    --e2e) E2E=1 ;;
    --staged) SCOPE="--staged" ;;
  esac
done

fail=0
step() { echo; echo "▶ $1"; shift; "$@" || { echo "✖ 실패: $1"; fail=1; }; }

step "타입 검사" bun run typecheck
step "린트" bun run lint
step "단위/컴포넌트 테스트" bun run test
[ "$E2E" = 1 ] && step "E2E 테스트" bun run test:e2e

echo; echo "▶ 버튼/폼 테스트 커버리지 (경고만, 커밋을 막지 않음)"
node scripts/list-interactions.mjs "$SCOPE" | grep -E "^(상호작용|MISS)" || true

echo
if [ "$fail" = 0 ]; then echo "✔ 기능 검사 통과"; else echo "✖ 기능 검사 실패"; fi
exit "$fail"
