#!/usr/bin/env node
// UI 코드에서 클릭/제출 핸들러가 달린 요소(버튼, 폼 등)를 찾아
// 같은 라벨을 다루는 테스트(*.test.ts(x), e2e/*.spec.ts)가 있는지 보고한다.
//
// 사용: node scripts/list-interactions.mjs [--changed|--staged] [--strict] [--json]
//   --changed  작업 트리에서 바뀐 파일만 검사 (기본: 전체)
//   --staged   스테이지된 파일만 검사
//   --strict   테스트가 없는 상호작용이 있으면 종료 코드 1
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = new Set(process.argv.slice(2));
const root = process.cwd();
const SRC_DIRS = ["app", "features", "components"];
const SKIP = /node_modules|\.next|components\/ui\//;
const HANDLERS = ["onClick", "onSubmit"];

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const rel = relative(root, p).replaceAll("\\", "/");
    if (SKIP.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(rel);
  }
  return out;
}

const isTest = (f) => /\.test\.tsx?$/.test(f) || /^e2e\/.*\.spec\.ts$/.test(f);
const git = (cmd) => execSync(cmd, { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);

let sources = SRC_DIRS.flatMap((d) => walk(d)).filter((f) => f.endsWith(".tsx") && !isTest(f));
if (args.has("--staged")) {
  const set = new Set(git("git diff --cached --name-only --diff-filter=ACMR"));
  sources = sources.filter((f) => set.has(f));
} else if (args.has("--changed")) {
  const set = new Set([...git("git diff --name-only HEAD"), ...git("git ls-files --others --exclude-standard")]);
  sources = sources.filter((f) => set.has(f));
}

const testCorpus = [...walk("app"), ...walk("features"), ...walk("components"), ...walk("lib"), ...walk("e2e")]
  .filter(isTest)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// "<Tag ...attrs>" 의 attrs 끝(중괄호 안의 '>' 는 무시)을 찾는다.
function scanTag(src, start) {
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

function labelOf(tag, attrs, body) {
  if (tag === "form") {
    // 폼은 제출 버튼의 텍스트를 라벨로 쓴다.
    const submit = body.match(/<(?:Button|button)\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/(?:Button|button)>/);
    return submit ? labelOf("button", "", submit[1]) : "";
  }
  const aria = attrs.match(/aria-label="([^"]+)"/);
  if (aria) return aria[1];
  const text = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\{`([^`]*)`\}|\{"([^"]*)"\}|\{'([^']*)'\}/g, (_, a, b, c) => a ?? b ?? c ?? "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 60);
}

const found = [];
for (const file of sources) {
  const src = readFileSync(file, "utf8");
  const tagRe = /<([A-Za-z][\w.]*)(?=[\s>])/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const end = scanTag(src, m.index + m[0].length);
    if (end < 0) continue;
    const attrs = src.slice(m.index + m[0].length, end);
    const handler = HANDLERS.find((h) => new RegExp(`\\b${h}=`).test(attrs));
    if (!handler) continue;
    const closeIdx = src.indexOf(`</${m[1]}>`, end);
    const body = attrs.endsWith("/") || closeIdx < 0 ? "" : src.slice(end + 1, closeIdx);
    const label = labelOf(m[1], attrs, body);
    const action = attrs.match(new RegExp(`${handler}=\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`))?.[1].trim().replace(/\s+/g, " ").slice(0, 70) ?? "";
    const line = src.slice(0, m.index).split("\n").length;
    const covered = label ? testCorpus.includes(label) : false;
    found.push({ file, line, tag: m[1], handler, label, action, covered });
  }
}

if (args.has("--json")) {
  console.log(JSON.stringify(found, null, 2));
} else {
  const missing = found.filter((f) => !f.covered);
  console.log(`상호작용 요소 ${found.length}개 중 테스트에서 확인되지 않은 것 ${missing.length}개`);
  for (const f of found) {
    const mark = f.covered ? "OK  " : "MISS";
    console.log(`${mark} ${f.file}:${f.line}  <${f.tag}> ${f.label ? `"${f.label}"` : "(텍스트 라벨 없음)"}  ${f.handler}=${f.action}`);
  }
}
if (args.has("--strict") && found.some((f) => !f.covered)) process.exit(1);
