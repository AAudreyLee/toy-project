import type { SpecDoc } from "./types";

const TASK_WORDS = /수집|디자인|알고리즘|연동|정보 입력|사용자 정보|로그인|계정|프로필|구현|개발|서버|데이터베이스|API|인터페이스/;
const VAGUE_CHECK = /정확|올바른|제대로|잘 (?:되|됐|된|동작|작동|나오|보이)|비교|일치|문제 없|성능/;
const MAX_SCOPE = 4;
// 확인 방법에 이런 표현이 나오면 결과나 범위에도 같은 표현이 있어야 한다. 범위에 없는 기능을 확인하라고 할 수 없다.
const OUTSIDE_SCOPE = [/알림|전송|메일|메신저/, /다른 사람|그룹원|팀원|친구|멤버/];

/** 첫 Spec이 "한 번에 만들고 직접 써 볼 수 있는 결과 하나"에서 벗어난 곳을 찾아 다시 쓰라고 안내할 문장으로 돌려준다. */
export function specViolations(doc: SpecDoc): string[] {
  const out: string[] = [];
  const empty = [
    !doc.result.trim() && "사용자가 얻는 결과(result)",
    !doc.scope.length && "범위(scope)",
    !doc.verification.length && "확인 방법(verification)",
    !doc.notNow.trim() && "이번엔 하지 않는 것(notNow)",
  ].filter(Boolean);
  if (empty.length) out.push(`비어 있는 항목이 있어요: ${empty.join(", ")}. 네 항목을 모두 채워 주세요.`);
  if (doc.scope.length > MAX_SCOPE) out.push(`범위가 ${doc.scope.length}개예요. ${MAX_SCOPE}개 이하로 줄여 주세요.`);
  const tasks = doc.scope.filter((s) => TASK_WORDS.test(s));
  if (tasks.length) out.push(`범위에 개발 작업 이름이 있어요(${tasks.join(", ")}). 사용자가 화면에서 보거나 하는 일로 바꿔 주세요.`);
  const vague = doc.verification.filter((v) => v.trim().length < 12 || VAGUE_CHECK.test(v));
  if (vague.length) out.push(`확인 방법이 막연해요(${vague.join(", ")}). 사용자가 직접 해 보고 눈으로 확인하는 행동과 기대 결과를 함께 적어 주세요.`);
  const covered = `${doc.result} ${doc.scope.join(" ")}`;
  const outside = doc.verification.filter((v) => OUTSIDE_SCOPE.some((p) => p.test(v) && !p.test(covered)));
  if (outside.length) out.push(`확인 방법이 결과와 범위에 없는 기능을 확인하라고 해요(${outside.join(", ")}). 범위 안의 일만 확인하도록 바꿔 주세요.`);
  return out;
}
