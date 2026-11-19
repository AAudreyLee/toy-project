// 저장된 trace를 새 심사 지시로 다시 채점한다. Azure는 호출하지 않는다.
// 사용법: bun run rejudge.ts --from v7 --split test
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError, judgeIdeas, judgeSpec } from "./judge";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? "true"]] : acc), []),
);
const from = args.from ?? "v7";
const split = args.split ?? "test";
const dir = join(import.meta.dir, "results", from);
const outDir = join(import.meta.dir, "results", `${from}-rejudge`);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "results.jsonl");

const ROOT = join(import.meta.dir, "..", "..", "..");
const cases: Record<string, { split: string; materials?: string[] }> = Object.fromEntries(
  readFileSync(join(ROOT, "docs", "specs", "guided-planning-to-spec", "eval-cases.jsonl"), "utf8").trim().split("\n").map((l) => { const c = JSON.parse(l); return [c.id, c]; }),
);
const old = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.split === split);
const done = new Set(existsSync(outPath) ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.prompt_id}#${r.rep}`; }) : []);

const queue = old.filter((r) => !done.has(`${r.prompt_id}#${r.rep}`));
let n = 0;
async function worker() {
  while (queue.length) {
    const r = queue.shift()!;
    const trace = JSON.parse(readFileSync(join(dir, "traces", `${r.prompt_id}_rep${r.rep}.json`), "utf8"));
    const grade: Record<string, number> = { q_ok: r.grade.q_ok, q_total: r.grade.q_total, one_question: r.grade.one_question };
    const checks: Record<string, unknown> = {};
    try {
      const c = cases[r.prompt_id];
      const ideasStep = trace.steps[0]?.ideas ? trace.steps[0] : null;
      if (c.materials && ideasStep) {
        const j = await judgeIdeas(c.materials, ideasStep.ideas);
        grade.ideas_ok = j.ok ? 1 : 0;
        checks.ideas = j.verdicts;
      }
      const finalSpec = trace.steps.find((s: { finalSpec?: unknown }) => s.finalSpec).finalSpec;
      const s = await judgeSpec(finalSpec);
      checks.spec = s;
      grade.spec_ok = s.filled && s.single_result && s.right_size ? 1 : 0;
      writeFileSync(outPath, "", { flag: "a" });
      writeFileSync(outPath, JSON.stringify({ prompt_id: r.prompt_id, rep: r.rep, tags: r.tags, split: r.split, grade, checks, status: "ok", model: r.model, usage: null }) + "\n", { flag: "a" });
    } catch (e) {
      console.log(`실패 ${r.prompt_id}#${r.rep}: ${e instanceof ApiError ? "api" : "harness"} ${(e as Error).message.slice(0, 120)}`);
    }
    console.log(`진행 ${++n}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const rows = readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sum = (k: string) => rows.map((r) => r.grade[k]).filter((v): v is number => v !== undefined);
const ideas = sum("ideas_ok"), spec = sum("spec_ok");
const t = (a: number[]) => `${a.reduce((x, y) => x + y, 0)}/${a.length} (${((a.reduce((x, y) => x + y, 0) / a.length) * 100).toFixed(0)}%)`;
console.log(`[${from}-rejudge/${split}] 아이디어 추천 ${t(ideas)} | 첫 Spec 크기 ${t(spec)}`);
