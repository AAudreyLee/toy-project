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
// 심사 지시 v3 (사용자 지시 2026-11-19): Spec도 문서에 명시된 내용만 근거로 판정하고, 추측은 false로 하지 않는다. 구현되지 않은 기능(로그인·계정·결제 등)이 scope에 있으면 실패가 아니라 보류로 빼서 따로 센다.
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
- right_size: scope가 5개 이하이고, 여러 화면·여러 플랫폼이 적혀 있지 않으며, verification이 사용자가 직접 해 보고 확인하는 행동이다. verification이 구체적이라는 것은 다음 셋이 문장에 모두 있다는 뜻이다. (1) 사용자가 하는 일(무엇을 입력하거나 고르거나 설정하는지), (2) 언제 확인하면 되는지(행동 직후면 충분하다. 예: "입력하면", "누르면", "저장한 직후". "나중에", "때가 되면"은 시점이 아니다), (3) 무엇이 보이는지(어느 화면에 어떤 내용이 보이는지). 셋이 모두 있으면 구체적이므로, 그 밖의 세부(몇 개가 나오는지, 실제 데이터 값)를 더 요구하지 않는다. 세 요소 중 문장에 없는 것이 있을 때만 false로 하고 reason에 빠진 요소를 적는다. 다음은 false다: 앱 밖의 현실 활동(실제로 가서 즐겨 본다), "잘 되는지", "정확한지", "제대로 나오는지"처럼 무엇을 보면 되는지 알 수 없는 막연한 표현, scope에 없는 기능을 확인하는 방법.
판정 원칙: 문서에 명시적으로 적힌 내용만 근거로 삼습니다. "~가 필요할 수 있다", "~가 필요해 보인다", "연동에 계정 연결이 필요할 가능성이 있다" 같은 추측만으로는 false로 하지 않습니다. reason에는 문제가 된 문구를 문서에서 인용합니다. 인용할 문구가 없으면 true입니다.
보류: 이 서비스가 만들 수 있는 기능은 날씨와 미세먼지, 따릉이 대여소, 문화행사, 박스오피스, 장소 검색, 뉴스 검색, 환율, 글 요약, 데이터를 읽고 하는 추천, 사진 읽기, 사용자가 남긴 기록, 그리고 화면에서 입력·선택·보기입니다. 알림 기능(메일, 메신저 메시지, 푸시 등 시간이 지나 사용자에게 보내는 것 전부)은 없습니다. 혼자 쓰는 서비스라서 로그인·계정·결제·사용자마다 다른 화면·여러 사람이 함께 쓰는 기능도 구현되어 있지 않습니다. scope에 이런 구현되지 않은 기능(알림 포함)이 적혀 있으면 그 항목은 실패로 보지 않고 hold 목록에 항목 문구와 이유를 적습니다. hold 항목과 그것만 확인하는 verification은 right_size 판정에서 제외합니다. 나머지로 판정할 것이 없으면 right_size는 true입니다.
JSON 객체 하나로만 답하세요: {"single_result":true,"right_size":true,"hold":[{"item":"...","reason":"..."}],"reason":"..."}`;
  const j = (await judge(prompt)) as { single_result?: boolean; right_size?: boolean; hold?: { item?: string; reason?: string }[]; reason?: string };
  return { filled, single_result: j.single_result === true, right_size: j.right_size === true, hold: j.hold ?? [], reason: j.reason ?? "" };
}
