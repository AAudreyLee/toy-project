// 4·5단계 agent 구현 품질 eval 실행기. 사용법:
//   bun run run.ts --mode support|build --variant baseline --split train|test|all --reps 2 [--concurrency 4]
// 앱의 실제 진입점(handleDeliveryRequest)을 호출한다. 판정은 코드로만 한다(지원 범위는 사례의 label과 비교, 빌드는 next build 종료 코드).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { handleDeliveryRequest } from "../../../../features/guided-planning/delivery/server";
import { starterFiles } from "../../../../features/guided-planning/delivery/generate";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CASES = join(ROOT, "docs", "specs", "guided-implementation-to-deploy", "eval-cases.jsonl");

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? "true"]] : acc), []),
);
const mode = args.mode ?? "support";
const variant = args.variant ?? "baseline";
const split = args.split ?? "all";
const reps = Number(args.reps ?? 2);
const concurrency = Number(args.concurrency ?? (mode === "build" ? 2 : 6));
const ids = args.ids?.split(",");
const limit = args.limit ? Number(args.limit) : Infinity;

function env(name: string): string {
  const line = readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return (line ?? "").slice(name.length + 1).replace(/^"|"$/g, "").trim();
}
const connection = { apiKey: env("AZURE_OPENAI_API_KEY"), endpoint: env("AZURE_OPENAI_ENDPOINT"), deployment: env("AZURE_OPENAI_DEPLOYMENT") };

type Case = { id: string; split: "train" | "test"; label: "supported" | "unsupported"; reason: string; spec: unknown; direction: unknown };
const cases: Case[] = readFileSync(CASES, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const outDir = join(import.meta.dir, "results", `${mode}-${variant}`);
mkdirSync(join(outDir, "traces"), { recursive: true });
const resultsPath = join(outDir, "results.jsonl");
const errorsPath = join(outDir, "errors.jsonl");
const done = new Set<string>(
  existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.prompt_id}#${r.rep}`; }) : [],
);

// ── 지원 범위 판정 ──
async function supportTrial(c: Case) {
  const res = await handleDeliveryRequest({ kind: "plan", connection, spec: c.spec, direction: c.direction }, {}, fetch);
  if (!res.ok) throw new Error(`api: ${res.message}`);
  const supported = res.supported === true;
  return { grade: { support_ok: supported === (c.label === "supported") ? 1 : 0 }, trace: { label: c.label, judged: res } };
}

// ── 빌드 ──
const SCRATCH = join(tmpdir(), "guided-delivery-eval");
const BASE = join(SCRATCH, "base");
async function ensureBase() {
  if (existsSync(join(BASE, "node_modules", "next"))) return;
  mkdirSync(BASE, { recursive: true });
  writeFileSync(join(BASE, "package.json"), starterFiles("eval-base")["package.json"]);
  const p = Bun.spawn(["bun", "install"], { cwd: BASE, stdout: "pipe", stderr: "pipe" });
  await p.exited;
  if (!existsSync(join(BASE, "node_modules", "next"))) throw new Error("기본 의존성을 설치하지 못했어요");
}

async function nextBuild(dir: string): Promise<{ ok: boolean; log: string }> {
  // 작업 폴더는 기본 폴더 안에 있어서, 심볼릭 링크 없이 위쪽 node_modules를 찾는다(Turbopack은 작업 영역 밖 링크를 컴파일하지 않는다).
  const bin = join(BASE, "node_modules", "next", "dist", "bin", "next");
  const proc = Bun.spawn(["node", bin, "build"], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  const timer = setTimeout(() => proc.kill(), 300_000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  const log = `${out}\n${err}`.split(/\r?\n/).filter((l) => l.trim()).slice(-80).join("\n").slice(-4000);
  return { ok: code === 0, log };
}

function writeProject(dir: string, files: Record<string, string>) {
  rmSync(join(dir, "app"), { recursive: true, force: true });
  rmSync(join(dir, "components"), { recursive: true, force: true });
  rmSync(join(dir, ".next"), { recursive: true, force: true });
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
}

async function buildTrial(c: Case, rep: number) {
  await ensureBase();
  const dir = mkdtempSync(join(BASE, `w-${c.id}-${rep}-`));
  try {
    const gen = await handleDeliveryRequest({ kind: "generate", connection, spec: c.spec, direction: c.direction, repoName: "eval-app" }, {}, fetch);
    if (!gen.ok) throw new Error(`api: ${gen.message}`);
    let files = gen.files as Record<string, string>;
    const attempts: { ok: boolean; log: string }[] = [];
    let fixes = 0;
    for (;;) {
      writeProject(dir, files);
      const b = await nextBuild(dir);
      attempts.push(b);
      if (b.ok || fixes >= 2) break;
      const fix = await handleDeliveryRequest({ kind: "fix", connection, files, buildLog: b.log }, {}, fetch);
      if (!fix.ok) break;
      files = fix.files as Record<string, string>;
      fixes += 1;
    }
    const ok = attempts.at(-1)!.ok;
    return { grade: { build_ok: ok ? 1 : 0, first_build_ok: attempts[0].ok ? 1 : 0, fixes }, trace: { attempts, files } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 실행 ──
const picked = cases
  .filter((c) => (ids ? ids.includes(c.id) : split === "all" || c.split === split))
  .filter((c) => mode !== "build" || c.label === "supported")
  .slice(0, limit);
const queue: { c: Case; rep: number }[] = [];
for (const c of picked) for (let rep = 0; rep < reps; rep++) if (!done.has(`${c.id}#${rep}`)) queue.push({ c, rep });
console.log(`mode=${mode} variant=${variant} split=${split} 사례=${picked.length} 실행=${queue.length}`);

let finished = 0;
async function worker() {
  while (queue.length) {
    const { c, rep } = queue.shift()!;
    try {
      const { grade, trace } = mode === "build" ? await buildTrial(c, rep) : await supportTrial(c);
      writeFileSync(join(outDir, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(trace, null, 2));
      appendFileSync(resultsPath, JSON.stringify({ prompt_id: c.id, rep, tags: [c.label], split: c.split, label: c.label, grade, status: "ok", model: connection.deployment, usage: null }) + "\n");
    } catch (e) {
      appendFileSync(errorsPath, JSON.stringify({ prompt_id: c.id, rep, class: String((e as Error).message).startsWith("api:") ? "api" : "harness", error: String((e as Error).message).slice(0, 300) }) + "\n");
    }
    console.log(`진행 ${++finished}/${finished + queue.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const rows = existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const sel = rows.filter((r) => split === "all" || r.split === split);
const key = mode === "build" ? "build_ok" : "support_ok";
const total = sel.length;
const pass = sel.filter((r) => r.grade[key] === 1).length;
console.log(`\n[${mode}-${variant}/${split}] ${key} ${pass}/${total} (${total ? ((pass / total) * 100).toFixed(0) : "-"}%)`);
if (mode === "build") console.log(`첫 빌드 통과 ${sel.filter((r) => r.grade.first_build_ok === 1).length}/${total}`);
else {
  for (const lab of ["supported", "unsupported"]) {
    const s = sel.filter((r) => r.label === lab);
    console.log(`  ${lab}: ${s.filter((r) => r.grade.support_ok === 1).length}/${s.length}`);
  }
}
if (existsSync(errorsPath)) console.log(`오류 기록 ${readFileSync(errorsPath, "utf8").trim().split("\n").length}건`);
