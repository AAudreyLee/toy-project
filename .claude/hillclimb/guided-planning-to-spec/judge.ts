// 심사(claude CLI)와 코드 검사. run.ts와 rejudge.ts가 함께 쓴다.
import { ALL_MATERIALS } from "../../../features/guided-planning/materials";
import type { Progress } from "../../../features/guided-planning/types";

export class ApiError extends Error {}

export function questionCount(text: string): number {
  return text
    .split(/(?<=[.!?？\n])\s*/)
    .filter((s) => s.trim() && (/[?？]\s*$/.test(s.trim()) || /(나요|까요|인가요|있나요|할까요|세요\?)\s*$/.test(s.trim()))).length;
}

export async function judge(prompt: string): Promise<{ [k: string]: unknown }> {
  const proc = Bun.spawn(["claude", "-p", "--output-format", "json", "--tools", "", "--model", "sonnet"], {
    stdin: Buffer.from(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 180_000);
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  clearTimeout(timer);
  const res = JSON.parse(out) as { is_error?: boolean; result?: string };
  if (res.is_error) throw new ApiError(`judge: ${res.result}`);
  const body = res.result ?? "";
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`judge가 JSON을 주지 않음: ${body.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

// 심사 지시 v2 (사용자 승인 2026-11-19): 아이디어는 명시적 위반만 실패, Spec은 시간 지연 확인을 구체적이면 허용.
export async function judgeIdeas(selected: string[], ideas: { title: string; summary: string }[]) {
  const prompt = `당신은 서비스 아이디어 추천을 채점하는 심사자입니다.
재료 전체 목록: ${ALL_MATERIALS.join(", ")}
사용자가 고른 재료: ${selected.join(", ")}
각 아이디어가 "고른 재료만으로 설명되는지" 판정하세요.
- 아이디어 문장에 고르지 않은 재료의 기능이 명시적으로 드러날 때만 false입니다. 예: 메일을 고르지 않았는데 메일로 보냄, 사진 읽기를 고르지 않았는데 사진을 분석함, 기록 저장을 고르지 않았는데 기록을 저장하거나 다시 보여 줌, 추천을 고르지 않았는데 추천함.
- "~일 수 있다", "암묵적으로 필요해 보인다" 같은 추측만으로는 false로 하지 않습니다. 재료 목록에 없는 일반 기능(화면 보기, 간단한 계산, 위치를 직접 고르는 것)도 문제 삼지 않습니다.
- 고른 재료 목록을 먼저 확인하고, 고른 재료를 "고르지 않았다"고 판정하는 모순을 만들지 않습니다.
- reason에는 문제가 된 문구를 아이디어에서 인용합니다.
아이디어:
${ideas.map((i, n) => `${n + 1}. ${i.title}: ${i.summary}`).join("\n")}
JSON 객체 하나로만 답하세요: {"ideas":[{"index":1,"only_selected":true,"reason":"..."}, ...]}`;
  const j = (await judge(prompt)) as { ideas?: { only_selected?: boolean; reason?: string }[] };
  const verdicts = j.ideas ?? [];
  return { ok: verdicts.length === 3 && verdicts.every((v) => v.only_selected === true), verdicts };
}

export async function judgeSpec(spec: Progress["spec"]["doc"]) {
  const filled = !!spec.result.trim() && spec.scope.length >= 1 && spec.verification.length >= 1 && !!spec.notNow.trim();
  const prompt = `당신은 "첫 Spec" 문서를 채점하는 심사자입니다. 첫 Spec은 사용자가 한 번에 만들어 직접 써 보고 확인할 수 있는 결과 하나만 담아야 합니다.
문서:
${JSON.stringify(spec, null, 2)}
참고: 대화 마지막에 사용자가 "기록도 남기고 알림도 여러 개 받고 싶다"며 결과를 늘리려 했습니다.
다음 둘을 판정하세요.
- single_result: result가 사용자가 얻는 서로 다른 결과를 둘 이상 나열하지 않는다. 늘리려던 추가 결과(기록, 여러 알림 등)가 result나 scope에 섞여 들어갔다면 false. notNow에 미뤄 둔 것은 괜찮다.
- right_size: scope가 5개 이하이고, 계정·로그인·결제·여러 화면·여러 플랫폼이 필요하지 않으며, verification이 사용자가 직접 해 보고 확인하는 행동이다. 다음은 허용한다: 알림이나 메일처럼 시간이 지나 도착하는 결과를 "다음 날 아침 7시에 알림이 오는지"처럼 구체적인 시점과 함께 확인하는 방법. 다음은 false다: 앱 밖의 현실 활동(실제로 가서 즐겨 본다), "잘 되는지", "정확한지", "제대로 나오는지"처럼 무엇을 보면 되는지 알 수 없는 막연한 표현, scope에 없는 기능을 확인하는 방법.
JSON 객체 하나로만 답하세요: {"single_result":true,"right_size":true,"reason":"..."}`;
  const j = (await judge(prompt)) as { single_result?: boolean; right_size?: boolean; reason?: string };
  return { filled, single_result: j.single_result === true, right_size: j.right_size === true, reason: j.reason ?? "" };
}
