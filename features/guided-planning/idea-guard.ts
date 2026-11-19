import { ALL_MATERIALS } from "./materials";

type IdeaText = { title: string; summary: string };

// 아이디어 문장에 이런 표현이 나오면 오른쪽 재료 중 하나를 골랐어야 한다.
const NEEDS: { pattern: RegExp; anyOf: string[] }[] = [
  { pattern: /요약|정리해|한 줄로 줄/, anyOf: ["글 요약"] },
  { pattern: /기록|즐겨찾기|저장|자주 (?:가는|이용)|등록해|설정한|설정하면|정해 두|이전에/, anyOf: ["사용자가 남긴 기록"] },
  { pattern: /맞춤|개인화|나에게 맞는|취향/, anyOf: ["사용자마다 다른 화면", "데이터를 읽고 하는 추천"] },
  { pattern: /추천/, anyOf: ["데이터를 읽고 하는 추천"] },
  { pattern: /사진/, anyOf: ["사진 읽기"] },
  { pattern: /알림|알려|보내/, anyOf: ["메일", "메신저로 보내는 메시지"] },
  { pattern: /메일/, anyOf: ["메일"] },
  { pattern: /메신저|카톡/, anyOf: ["메신저로 보내는 메시지"] },
  // 재료 목록에 없는 데이터가 있어야 하는 표현이라 어떤 재료를 골라도 쓸 수 없다.
  { pattern: /인기|순위|평점|리뷰|자주 (?:대여|이용|가는|쓰는)/, anyOf: [] },
];

/** 고른 재료로 설명되지 않는 아이디어를 찾아, 다시 쓰라고 안내할 문장으로 돌려준다. */
export function ideaViolations(ideas: IdeaText[], selected: string[]): string[] {
  const out: string[] = [];
  ideas.forEach((idea, i) => {
    const text = `${idea.title} ${idea.summary}`;
    const missing = NEEDS.filter((n) => n.pattern.test(text) && !n.anyOf.some((m) => selected.includes(m)));
    if (missing.length) {
      const needs = [...new Set(missing.flatMap((m) => m.anyOf))].filter((m) => ALL_MATERIALS.includes(m));
      out.push(
        needs.length
          ? `${i + 1}번 "${idea.title}"은(는) 고르지 않은 재료(${needs.join(" 또는 ")})가 필요한 표현이 있어요.`
          : `${i + 1}번 "${idea.title}"은(는) 재료 목록에 없는 데이터(인기 순위, 리뷰, 평점, 이용 이력)가 필요한 표현이 있어요.`,
      );
    }
  });
  return out;
}
