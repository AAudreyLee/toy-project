# agent 대화 품질 eval이 아이디어 추천과 첫 Spec 크기에서 목표에 못 미친다

**Symptom**: 최종 판정용 20개 사례(반복 2회)에서 아이디어 추천 통과가 74%(14/19회), 첫 Spec 크기 통과가 79%(31/39회)로, 스펙 목표(재료 사례 10개 중 9개, 20개 중 18개)에 못 미친다. 질문 수 기준(96%)만 목표를 넘는다.

**Observed evidence**: `.claude/hillclimb/guided-planning-to-spec/run.ts`를 `--variant v7 --split test --reps 2`로 실행한 결과(Azure OpenAI 배포, 판정은 claude CLI). 사례와 판정 기준은 `docs/specs/guided-planning-to-spec/eval-cases.jsonl`, `eval-criteria.md`. baseline은 아이디어 9/20회, Spec 24/40회였고 튜닝 7라운드 뒤 v5와 v7이 같은 수준에서 멈췄다.

**Suspected cause**: 아이디어 추천은 모델이 고르지 않은 재료의 기능(기록, 추천, 요약)을 계속 요구한다. 첫 Spec은 심사자가 `scope`나 `verification`의 모호함을 이유로 크기 부적합 판정을 내리는 경우가 많고, 이 기준이 코드 검사보다 엄격하다. 둘 다 이 배포 모델이 프롬프트 규칙을 지키는 힘에 한계가 있을 가능성이 있지만 확인하지 않았다.

**What was tried**: 재료별 규칙과 좋은·나쁜 예시를 프롬프트에 넣고, 아이디어와 Spec 응답을 코드로 검사해 어긋나면 최대 두 번 다시 받게 했다. 점수는 baseline보다 올랐지만 목표에는 닿지 않았다.

**Proposed next step**: 더 강한 모델 배포로 같은 eval을 돌려 모델 한계인지 가른다. 그다음에도 미달이면 심사자의 `right_size` 기준을 사용자와 함께 다시 정하거나 스펙의 목표치를 조정한다(둘 다 승인된 계약 변경이라 사용자 결정이 필요하다).
