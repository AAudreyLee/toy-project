// agent 대화 품질 eval 실행기. 사용법:
//   bun run run.ts --variant baseline --split train|test|all --reps 2 [--limit 3] [--concurrency 6]
// 앱의 실제 진입점(handleAgentRequest)을 호출하고, 코드 검사와 claude CLI 판정으로 채점한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { handleAgentRequest } from "../../../features/guided-planning/agent";
import { addUserMessage, applyAgentReply, chooseIdea, createProgress, finishDirection } from "../../../features/guided-planning/progress";
import { ALL_MATERIALS } from "../../../features/guided-planning/materials";
import type { Connection, Progress, Stage } from "../../../features/guided-planning/types";

const ROOT = join(import.meta.dir, "..", "..", "..");
const CASES = join(ROOT, "docs", "specs", "guided-planning-to-spec", "eval-cases.jsonl");

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? "true"]] : acc), []),
);
const variant = args.variant ?? "baseline";
const split = args.split ?? "all";
const reps = Number(args.reps ?? 2);
const limit = args.limit ? Number(args.limit) : Infinity;
const concurrency = Number(args.concurrency ?? 6);

function env(name: string): string {
  const line = readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return (line ?? "").slice(name.length + 1).replace(/^"|"$/g, "").trim();
}
const connection: Connection = {
  apiKey: env("AZURE_OPENAI_API_KEY"),
  endpoint: env("AZURE_OPENAI_ENDPOINT"),
  deployment: env("AZURE_OPENAI_DEPLOYMENT"),
};

type Case = { id: string; split: "train" | "test"; kind: "material" | "idea"; tags: string[]; materials?: string[]; idea: string; turns: string[] };
const cases: Case[] = readFileSync(CASES, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const outDir = join(import.meta.dir, "results", variant);
mkdirSync(join(outDir, "traces"), { recursive: true });
const resultsPath = join(outDir, "results.jsonl");
const errorsPath = join(outDir, "errors.jsonl");
const done = new Set<string>(
  existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.prompt_id}#${r.rep}`; }) : [],
);

// ── 채점 ──
function questionCount(text: string): number {
  return text
    .split(/(?<=[.!?？\n])\s*/)
    .filter((s) => s.trim() && (/[?？]\s*$/.test(s.trim()) || /(나요|까요|인가요|있나요|할까요|세요\?)\s*$/.test(s.trim()))).length;
}

async function judge(prompt: string): Promise<{ [k: string]: unknown }> {
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

class ApiError extends Error {}

async function judgeIdeas(selected: string[], ideas: { title: string; summary: string }[]) {
  const prompt = `당신은 서비스 아이디어 추천을 채점하는 심사자입니다.
재료 전체 목록: ${ALL_MATERIALS.join(", ")}
사용자가 고른 재료: ${selected.join(", ")}
각 아이디어가 "고른 재료만으로 설명되는지" 판정하세요. 전체 목록의 재료 중 고르지 않은 것이 있어야 동작하는 아이디어(예: 메일을 고르지 않았는데 메일로 보냄, 사진 읽기를 고르지 않았는데 사진을 분석함, 로그인/기록 저장을 고르지 않았는데 기록을 저장함)면 false입니다. 재료 목록에 없는 일반 기능(화면 보기, 간단한 계산)은 문제 삼지 않습니다.
아이디어:
${ideas.map((i, n) => `${n + 1}. ${i.title}: ${i.summary}`).join("\n")}
JSON 객체 하나로만 답하세요: {"ideas":[{"index":1,"only_selected":true,"reason":"..."}, ...]}`;
  const j = (await judge(prompt)) as { ideas?: { only_selected?: boolean; reason?: string }[] };
  const verdicts = j.ideas ?? [];
  return { ok: verdicts.length === 3 && verdicts.every((v) => v.only_selected === true), verdicts };
}

async function judgeSpec(spec: Progress["spec"]["doc"]) {
  const filled =
    !!spec.result.trim() && spec.scope.length >= 1 && spec.verification.length >= 1 && !!spec.notNow.trim();
  const prompt = `당신은 "첫 Spec" 문서를 채점하는 심사자입니다. 첫 Spec은 사용자가 한 번에 만들어 직접 써 보고 확인할 수 있는 결과 하나만 담아야 합니다.
문서:
${JSON.stringify(spec, null, 2)}
참고: 대화 마지막에 사용자가 "기록도 남기고 알림도 여러 개 받고 싶다"며 결과를 늘리려 했습니다.
다음 둘을 판정하세요.
- single_result: result가 사용자가 얻는 서로 다른 결과를 둘 이상 나열하지 않는다. 늘리려던 추가 결과(기록, 여러 알림 등)가 result나 scope에 섞여 들어갔다면 false. notNow에 미뤄 둔 것은 괜찮다.
- right_size: scope가 5개 이하이고, 계정·로그인·결제·여러 화면·여러 플랫폼이 필요하지 않으며, verification이 사용자가 직접 해 보고 확인할 수 있는 행동이다.
JSON 객체 하나로만 답하세요: {"single_result":true,"right_size":true,"reason":"..."}`;
  const j = (await judge(prompt)) as { single_result?: boolean; right_size?: boolean; reason?: string };
  return { filled, single_result: j.single_result === true, right_size: j.right_size === true, reason: j.reason ?? "" };
}

// ── 한 (사례, 반복) 실행 ──
async function call(body: Record<string, unknown>) {
  const res = await handleAgentRequest({ ...body, connection });
  if (!res.ok && res.code !== "invalid") throw new ApiError(`${res.code}: ${res.message}`);
  if (!res.ok) throw new Error(res.message);
  return res;
}

async function runTrial(c: Case, rep: number) {
  const trace: Record<string, unknown> = { case: c.id, rep, steps: [] as unknown[] };
  const steps = trace.steps as unknown[];
  const grade: Record<string, number> = {};
  const checks: Record<string, unknown> = {};

  if (c.kind === "material") {
    const res = await call({ kind: "ideas", materials: c.materials });
    if (res.ok && res.kind === "ideas") {
      const j = await judgeIdeas(c.materials!, res.ideas);
      steps.push({ ideas: res.ideas, judge: j });
      grade.ideas_ok = j.ok ? 1 : 0;
      checks.ideas = j.verdicts;
    }
  }

  let p: Progress = chooseIdea(createProgress(), c.idea);
  const agentTexts: string[] = [];
  async function turn(stage: Stage, userText?: string) {
    if (userText) p = addUserMessage(p, stage, userText);
    const res = await call({
      kind: "chat",
      stage,
      projectName: p.projectName,
      idea: p.idea ?? "",
      doc: p[stage].doc,
      direction: p.direction.doc,
      messages: p[stage].messages,
    });
    if (res.ok && res.kind === "chat") {
      p = applyAgentReply(p, stage, res.reply);
      agentTexts.push(res.reply.message);
      steps.push({ stage, user: userText ?? "(시작)", agent: res.reply.message, questions: questionCount(res.reply.message), doc: p[stage].doc });
    }
  }
  const dirTurns = [undefined, c.turns[0], c.turns[1], "잘 모르겠어요, 예시를 보여주세요", "이 질문은 나중에"];
  for (const t of dirTurns) await turn("direction", t);
  p = finishDirection(p);
  for (const t of [undefined, "괜찮아요, 이대로 갈게요", "그런데 기록도 남기고 알림도 여러 개 받고 싶어요"]) await turn("spec", t);

  const qs = agentTexts.map(questionCount);
  grade.q_ok = qs.filter((n) => n <= 1).length;
  grade.q_total = qs.length;
  grade.one_question = grade.q_ok / grade.q_total;

  const s = await judgeSpec(p.spec.doc);
  checks.spec = s;
  grade.spec_ok = s.filled && s.single_result && s.right_size ? 1 : 0;
  steps.push({ finalSpec: p.spec.doc, judge: s });
  return { grade, checks, trace };
}

// ── 실행 ──
const queue: { c: Case; rep: number }[] = [];
const ids = args.ids?.split(",");
const picked = cases.filter((c) => (ids ? ids.includes(c.id) : split === "all" || c.split === split)).slice(0, limit);
for (const c of picked) for (let rep = 0; rep < reps; rep++) if (!done.has(`${c.id}#${rep}`)) queue.push({ c, rep });
console.log(`variant=${variant} split=${split} cases=${picked.length} reps=${reps} 실행=${queue.length} (이미 있음 ${picked.length * reps - queue.length})`);

let finished = 0;
async function worker() {
  while (queue.length) {
    const { c, rep } = queue.shift()!;
    try {
      const { grade, checks, trace } = await runTrial(c, rep);
      writeFileSync(join(outDir, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(trace, null, 2));
      appendFileSync(
        resultsPath,
        JSON.stringify({ prompt_id: c.id, rep, tags: c.tags, split: c.split, grade, checks, status: "ok", model: connection.deployment, usage: null }) + "\n",
      );
    } catch (e) {
      appendFileSync(errorsPath, JSON.stringify({ prompt_id: c.id, rep, class: e instanceof ApiError ? "api" : "harness", error: String((e as Error).message).slice(0, 300) }) + "\n");
    }
    console.log(`진행 ${++finished}/${finished + queue.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

// ── 요약 ──
const rows = existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const sel = rows.filter((r) => split === "all" || r.split === split);
const sum = (f: (r: any) => number | undefined) => sel.map(f).filter((v): v is number => v !== undefined);
const ideas = sum((r) => r.grade.ideas_ok);
const qOk = sum((r) => r.grade.q_ok).reduce((a, b) => a + b, 0);
const qTotal = sum((r) => r.grade.q_total).reduce((a, b) => a + b, 0);
const spec = sum((r) => r.grade.spec_ok);
const pct = (a: number, b: number) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(0)}%)` : "-");
console.log(`\n[${variant}/${split}] 아이디어 추천 통과 ${pct(ideas.reduce((a, b) => a + b, 0), ideas.length)}  |  한 번에 하나씩 묻기 ${pct(qOk, qTotal)}  |  첫 Spec 크기 ${pct(spec.reduce((a, b) => a + b, 0), spec.length)}`);
const errs = existsSync(errorsPath) ? readFileSync(errorsPath, "utf8").trim().split("\n").filter(Boolean).length : 0;
if (errs) console.log(`오류 기록 ${errs}건 (errors.jsonl)`);
