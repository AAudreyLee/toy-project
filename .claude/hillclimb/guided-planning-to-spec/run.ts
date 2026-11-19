// agent 대화 품질 eval 실행기. 사용법:
//   bun run run.ts --variant baseline --split train|test|all --reps 2 [--limit 3] [--concurrency 6]
// 앱의 실제 진입점(handleAgentRequest)을 호출하고, 코드 검사와 claude CLI 판정으로 채점한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { handleAgentRequest } from "../../../features/guided-planning/agent";
import { addUserMessage, applyAgentReply, chooseIdea, createProgress, finishDirection } from "../../../features/guided-planning/progress";
import { ApiError, judgeIdeas, judgeSpec, questionCount } from "./judge";
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
  grade.spec_hold = s.hold.length ? 1 : 0;
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
const hold = sum((r) => r.grade.spec_hold);
const pct = (a: number, b: number) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(0)}%)` : "-");
console.log(`\n[${variant}/${split}] 아이디어 추천 통과 ${pct(ideas.reduce((a, b) => a + b, 0), ideas.length)}  |  한 번에 하나씩 묻기 ${pct(qOk, qTotal)}  |  첫 Spec 크기 ${pct(spec.reduce((a, b) => a + b, 0), spec.length)}  |  보류 항목 있는 Spec(별도 집계) ${pct(hold.reduce((a, b) => a + b, 0), hold.length)}`);
const errs = existsSync(errorsPath) ? readFileSync(errorsPath, "utf8").trim().split("\n").filter(Boolean).length : 0;
if (errs) console.log(`오류 기록 ${errs}건 (errors.jsonl)`);
