import { AgentError, callAzure, extractJson, type WireMessage } from "../agent";
import type { Connection, DirectionDoc, SpecDoc } from "../types";
import { DeliveryError } from "./errors";

const MAX_RETRIES = 2;
const MAX_FILE_CHARS = 40_000;
const ALLOWED_PATH = /^(app\/page\.tsx|components\/[A-Za-z0-9_-]+\.tsx)$/;

export function starterFiles(repoName: string): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: repoName.toLowerCase(),
        version: "0.1.0",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "15.1.6", react: "19.0.0", "react-dom": "19.0.0" },
        devDependencies: { typescript: "^5", "@types/node": "^22", "@types/react": "^19", "@types/react-dom": "^19" },
      },
      null,
      2,
    ),
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
    "next.config.mjs": "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n",
    "app/layout.tsx": [
      'import type { ReactNode } from "react";',
      'import "./globals.css";',
      "",
      'export const metadata = { title: "내가 만든 서비스" };',
      "",
      "export default function RootLayout({ children }: { children: ReactNode }) {",
      '  return (\n    <html lang="ko">\n      <body>{children}</body>\n    </html>\n  );',
      "}",
      "",
    ].join("\n"),
    "app/globals.css": [
      "* { box-sizing: border-box; }",
      "body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif; background: #fafaf9; color: #1c1917; line-height: 1.6; }",
      "main { max-width: 640px; margin: 0 auto; padding: 32px 16px; }",
      "h1 { font-size: 24px; margin: 0 0 8px; }",
      ".card { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 16px; margin: 16px 0; }",
      "input, select, textarea { width: 100%; padding: 8px 10px; border: 1px solid #d6d3d1; border-radius: 8px; font: inherit; }",
      "button { padding: 8px 14px; border: 0; border-radius: 8px; background: #b45309; color: #fff; font: inherit; cursor: pointer; }",
      "button:disabled { opacity: 0.5; cursor: not-allowed; }",
      ".muted { color: #78716c; font-size: 14px; }",
      "",
    ].join("\n"),
    ".gitignore": "node_modules\n.next\nnext-env.d.ts\n.env*\n.vercel\n",
    "README.md": `# ${repoName}\n\nagent가 첫 Spec으로 만든 시스템입니다. \`npm install\` 후 \`npm run dev\`로 실행합니다.\n`,
  };
}

/** 생성된 파일이 허용된 경로와 범위를 지키는지 검사해, 어긋난 곳을 다시 쓰라고 안내할 문장으로 돌려준다. */
export function validateGenerated(files: Record<string, string>): string[] {
  const problems: string[] = [];
  if (!("app/page.tsx" in files)) problems.push("app/page.tsx 파일이 꼭 있어야 해요.");
  for (const [path, content] of Object.entries(files)) {
    if (!ALLOWED_PATH.test(path)) {
      problems.push(`허용되지 않는 파일 경로예요: ${path} (app/page.tsx와 components/이름.tsx만 쓸 수 있어요).`);
      continue;
    }
    if (!content.trim()) problems.push(`${path} 파일이 비어 있어요.`);
    if (content.length > MAX_FILE_CHARS) problems.push(`${path} 파일이 너무 커요. 더 작게 만들어 주세요.`);
    if (/process\.env|import\.meta\.env/.test(content)) problems.push(`${path}에서 환경 변수를 쓸 수 없어요. 키나 비밀 값 없이 동작해야 해요.`);
    const specifiers = [...content.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const s of specifiers) {
      const ok = s === "react" || s === "react-dom" || s.startsWith("next/") || s.startsWith("./") || s.startsWith("../") || s.startsWith("@/");
      if (!ok) problems.push(`${path}에서 허용되지 않는 패키지를 가져왔어요: ${s} (react, next, 프로젝트 안의 파일만 쓸 수 있어요).`);
    }
  }
  return problems;
}

function asDeliveryError(e: unknown): DeliveryError {
  if (e instanceof DeliveryError) return e;
  if (e instanceof AgentError) return new DeliveryError("failed", e.message);
  return new DeliveryError("failed", "agent가 코드를 만들지 못했어요.");
}

function specSummary(spec: SpecDoc, direction: DirectionDoc): string {
  return [`서비스 방향:\n${JSON.stringify(direction, null, 2)}`, `첫 Spec:\n${JSON.stringify(spec, null, 2)}`].join("\n\n");
}

const SUPPORT_SYSTEM = `당신은 비개발자가 만든 첫 Spec을 "추가 계정이나 키 없이 한 번에 만들어 배포할 수 있는지" 판정하는 심사자입니다.
만들 수 있는 것: 브라우저 화면에서 입력하고 결과를 계산해 보여 주는 것, 키가 필요 없는 공개 데이터를 화면에서 불러와 보여 주는 것, 같은 화면 안에서만 쓰는 임시 상태.
만들 수 없는 것(하나라도 필요하면 supported는 false): 데이터를 저장해 두었다가 다음에 다시 보여 주기(데이터베이스, 사용자 기록 저장), 메일이나 메신저 발송과 알림, 예약 실행(매일 아침 7시 같은 정해진 시각에 자동으로 도는 것), 로그인과 사용자별 화면, 키나 계정 가입이 필요한 외부 서비스(키가 필요한 공개 데이터 포함), 사진 업로드와 분석.
답은 JSON 객체 하나로만 합니다: {"supported": true|false, "reason": "만들 수 없는 이유를 쉬운 말 한두 문장(만들 수 있으면 빈 문자열)", "hint": "Spec을 어떻게 줄이면 만들 수 있는지 한 문장(만들 수 있으면 빈 문자열)"}`;

export async function judgeSupport(
  c: Connection,
  spec: SpecDoc,
  direction: DirectionDoc,
  f: typeof fetch = fetch,
): Promise<{ supported: boolean; reason: string; hint: string }> {
  const wire: WireMessage[] = [
    { role: "system", content: SUPPORT_SYSTEM },
    { role: "user", content: specSummary(spec, direction) },
  ];
  let text: string;
  try {
    text = await callAzure(c, wire, { json: true, maxTokens: 1000 }, f);
  } catch (e) {
    throw asDeliveryError(e);
  }
  try {
    const raw = extractJson(text) as { supported?: unknown; reason?: unknown; hint?: unknown };
    if (typeof raw.supported !== "boolean") throw new Error("supported가 없습니다");
    return { supported: raw.supported, reason: typeof raw.reason === "string" ? raw.reason : "", hint: typeof raw.hint === "string" ? raw.hint : "" };
  } catch {
    throw new DeliveryError("failed", "만들 수 있는 Spec인지 판단하지 못했어요. 다시 시도해 주세요.");
  }
}

const CODE_RULES = `규칙:
- 사용할 수 있는 파일은 app/page.tsx(꼭 필요)와 components/이름.tsx뿐입니다. 그 밖의 파일은 이미 준비되어 있습니다.
- 파일 맨 위에 "use client";를 쓰고, React 상태(useState 등)만으로 한 화면에서 동작하게 만듭니다.
- react와 next, 프로젝트 안의 파일만 가져옵니다. 다른 패키지는 설치되어 있지 않습니다.
- 환경 변수, 키, 서버, 데이터베이스는 쓰지 않습니다. 키가 필요 없는 공개 데이터는 브라우저에서 fetch로 불러올 수 있습니다.
- 모든 화면 문구는 한국어입니다. 스타일은 globals.css에 있는 card, muted 클래스와 기본 input, button 모양을 쓰고, 필요하면 인라인 style을 씁니다.
- 첫 Spec의 result 하나를 만족하는 가장 단순한 화면을 만들고, scope에 없는 기능은 넣지 않습니다. verification에 적힌 확인을 화면에서 바로 해 볼 수 있어야 합니다.
- 타입 오류 없이 next build가 통과해야 합니다. any는 쓰지 말고 이벤트와 상태에 타입을 적습니다.
답은 JSON 객체 하나로만 합니다: {"files": {"app/page.tsx": "파일 전체 내용", "components/이름.tsx": "..."}}`;

async function askFiles(c: Connection, wire: WireMessage[], f: typeof fetch): Promise<Record<string, string>> {
  for (let attempt = 0; ; attempt++) {
    let text: string;
    try {
      text = await callAzure(c, wire, { json: true, maxTokens: 12000 }, f);
    } catch (e) {
      throw asDeliveryError(e);
    }
    let files: Record<string, string> | null = null;
    let problems: string[];
    try {
      const raw = extractJson(text) as { files?: Record<string, unknown> };
      files = Object.fromEntries(Object.entries(raw.files ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      problems = validateGenerated(files);
    } catch {
      problems = ['JSON 형식이 아니에요. {"files": {...}} 형식으로 다시 주세요.'];
    }
    if (!problems.length && files) return files;
    if (attempt >= MAX_RETRIES) throw new DeliveryError("failed", `agent가 규칙에 맞는 코드를 만들지 못했어요. ${problems[0]}`);
    wire.push({ role: "assistant", content: text }, { role: "user", content: `${problems.join("\n")}\n이 점을 고쳐서 같은 JSON 형식으로 다시 답해 주세요.` });
  }
}

export async function generateFiles(
  c: Connection,
  input: { spec: SpecDoc; direction: DirectionDoc; repoName: string },
  f: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const wire: WireMessage[] = [
    {
      role: "system",
      content: `당신은 첫 Spec을 Next.js 화면 하나로 구현하는 개발자입니다. 프로젝트 뼈대(package.json, tsconfig, layout, globals.css)는 준비되어 있고, 당신은 화면 코드만 만듭니다.\n${CODE_RULES}`,
    },
    { role: "user", content: specSummary(input.spec, input.direction) },
  ];
  const generated = await askFiles(c, wire, f);
  return { ...starterFiles(input.repoName), ...generated };
}

export async function fixFiles(
  c: Connection,
  input: { files: Record<string, string>; buildLog: string },
  f: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const editable = Object.fromEntries(Object.entries(input.files).filter(([p]) => ALLOWED_PATH.test(p)));
  const wire: WireMessage[] = [
    {
      role: "system",
      content: `당신은 배포 빌드가 실패한 Next.js 화면 코드를 고치는 개발자입니다. 아래 빌드 로그의 원인을 고쳐 파일 전체를 다시 줍니다.\n${CODE_RULES}`,
    },
    { role: "user", content: `빌드 로그:\n${input.buildLog}\n\n현재 코드:\n${JSON.stringify({ files: editable }, null, 2)}` },
  ];
  const fixed = await askFiles(c, wire, f);
  return { ...input.files, ...fixed };
}
