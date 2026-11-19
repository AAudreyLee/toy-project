// 서버 저장 결과(guided-server-data-storage)의 agent 품질 eval 실행기. 사용법:
//   bun run run.ts --mode judge|build --split train|test|all --reps 2 [--concurrency 4] [--ids d01,b02]
// 앱의 실제 진입점(handleDeliveryRequest)을 호출한다. 판정은 코드로만 한다.
//   judge: 세 갈래(supported 브라우저 저장만 / database 서버 저장 필요 / unsupported 막음) 판정이 사례 label과 맞는지.
//   build: 서버 저장 사례(label database)로 코드를 만들어 next build가 통과하는지와 비밀 키 노출 규칙을 지키는지.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { handleDeliveryRequest } from "../../../features/guided-planning/delivery/server";
import { starterFiles } from "../../../features/guided-planning/delivery/generate";

const ROOT = join(import.meta.dir, "..", "..", "..");
const NEW_CASES = join(ROOT, "docs", "specs", "guided-server-data-storage", "eval-cases.jsonl");
const OLD_CASES = join(ROOT, "docs", "specs", "guided-implementation-to-deploy", "eval-cases.jsonl");

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? "true"]] : acc), []),
);
const mode = args.mode ?? "judge";
const split = args.split ?? "test";
const reps = Number(args.reps ?? 2);
const concurrency = Number(args.concurrency ?? (mode === "build" ? 2 : 6));
const ids = args.ids?.split(",");
const tag = args.tag ?? "run";

function env(name: string): string {
  const line = readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return (line ?? "").slice(name.length + 1).replace(/^"|"$/g, "").trim();
}
const connection = { apiKey: env("AZURE_OPENAI_API_KEY"), endpoint: env("AZURE_OPENAI_ENDPOINT"), deployment: env("AZURE_OPENAI_DEPLOYMENT") };

type Label = "supported" | "database" | "unsupported";
type Case = { id: string; split: "train" | "test"; label: Label; reason: string; spec: unknown; direction: unknown };
const load = (p: string) =>
  readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Case);
// 앞선 결과의 사례는 브라우저 저장소로 충분한 것(supported)과 막아야 하는 것(unsupported) 그대로 쓴다.
const cases = [...load(OLD_CASES), ...load(NEW_CASES)].filter((c) => (split === "all" || c.split === split) && (!ids || ids.includes(c.id)));
const buildCases = cases.filter((c) => c.label === "database");

const outDir = join(import.meta.dir, "results", `${mode}-${tag}`);
mkdirSync(join(outDir, "traces"), { recursive: true });
const resultsPath = join(outDir, "results.jsonl");

async function judgeTrial(c: Case) {
  const res = await handleDeliveryRequest({ kind: "plan", connection, spec: c.spec, direction: c.direction }, {}, fetch);
  if (!res.ok) throw new Error(`api: ${res.message}`);
  const got: Label = res.supported !== true ? "unsupported" : res.needsDatabase === true ? "database" : "supported";
  return { ok: got === c.label ? 1 : 0, trace: { label: c.label, got, judged: res } };
}

const SCRATCH = join(tmpdir(), "guided-server-data-eval");
const BASE = join(SCRATCH, "base");
async function ensureBase() {
  if (existsSync(join(BASE, "node_modules", "next"))) return;
  mkdirSync(BASE, { recursive: true });
  writeFileSync(join(BASE, "package.json"), starterFiles("eval-base", { database: true })["package.json"]);
  const p = Bun.spawn(["bun", "install"], { cwd: BASE, stdout: "pipe", stderr: "pipe" });
  await p.exited;
  if (!existsSync(join(BASE, "node_modules", "next"))) throw new Error("기본 의존성을 설치하지 못했어요");
}

async function nextBuild(dir: string): Promise<{ ok: boolean; log: string }> {
  const bin = join(BASE, "node_modules", "next", "dist", "bin", "next");
  // 실제 배포에서는 연결된 데이터베이스의 DATABASE_URL이 빌드에도 주입되므로, 같은 모양의 가짜 값을 준다(접속은 하지 않는다).
  const proc = Bun.spawn(["node", bin, "build"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "postgresql://user:pass@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require" },
  });
  const timer = setTimeout(() => proc.kill(), 300_000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  const log = `${out}\n${err}`.split(/\r?\n/).filter((l) => l.trim()).slice(-80).join("\n").slice(-4000);
  return { ok: code === 0, log };
}

async function buildTrial(c: Case, rep: number) {
  await ensureBase();
  const dir = mkdtempSync(join(BASE, `w-${c.id}-${rep}-`));
  try {
    const gen = await handleDeliveryRequest({ kind: "generate", connection, spec: c.spec, direction: c.direction, repoName: "eval-app", database: true }, {}, fetch);
    if (!gen.ok) return { ok: 0, trace: { stage: "generate", message: gen.message } };
    let files = gen.files as Record<string, string>;
    for (const [p, content] of Object.entries(files)) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    let build = await nextBuild(dir);
    // 배포와 같이 빌드가 실패하면 자동 수정을 최대 2번 시도하고 최종 결과로 판정한다.
    for (let fix = 0; !build.ok && fix < 2; fix++) {
      const fixed = await handleDeliveryRequest({ kind: "fix", connection, files, buildLog: build.log, database: true }, {}, fetch);
      if (!fixed.ok) break;
      files = fixed.files as Record<string, string>;
      rmSync(join(dir, ".next"), { recursive: true, force: true });
      for (const [p, content] of Object.entries(files)) {
        const full = join(dir, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      build = await nextBuild(dir);
    }
    // 비밀 키 노출 없음: 화면 코드(app/page.tsx, components)에 접속 정보나 서버 코드 가져오기가 없어야 한다.
    const leaks = Object.entries(files).filter(([p, c]) => (p === "app/page.tsx" || p.startsWith("components/")) && /process\.env|DATABASE_URL|@neondatabase|\/lib\//.test(c)).map(([p]) => p);
    return { ok: build.ok && !leaks.length ? 1 : 0, trace: { build_ok: build.ok, leaks, files: Object.keys(files), log: build.ok ? "" : build.log } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const jobs = (mode === "build" ? buildCases : cases).flatMap((c) => Array.from({ length: reps }, (_, r) => ({ c, rep: r + 1 })));
let next = 0;
const rows: { id: string; label: Label; rep: number; ok: number }[] = [];
async function worker() {
  while (next < jobs.length) {
    const { c, rep } = jobs[next++];
    try {
      const r = mode === "build" ? await buildTrial(c, rep) : await judgeTrial(c);
      rows.push({ id: c.id, label: c.label, rep, ok: r.ok });
      appendFileSync(resultsPath, JSON.stringify({ id: c.id, label: c.label, rep, ok: r.ok }) + "\n");
      writeFileSync(join(outDir, "traces", `${c.id}-r${rep}.json`), JSON.stringify(r.trace, null, 2));
    } catch (e) {
      console.error(`오류 ${c.id}#${rep}: ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : "-");
console.log(`\n[${mode}] split=${split} reps=${reps}`);
console.log("전체:", pct(rows.filter((r) => r.ok).length, rows.length));
for (const l of ["supported", "database", "unsupported"] as Label[]) {
  const sub = rows.filter((r) => r.label === l);
  if (sub.length) console.log(`${l}:`, pct(sub.filter((r) => r.ok).length, sub.length));
}
const bad = rows.filter((r) => !r.ok).map((r) => `${r.id}#${r.rep}`);
if (bad.length) console.log("틀린 사례:", bad.join(", "));
