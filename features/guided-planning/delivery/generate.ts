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
        dependencies: { next: "16.4.5", react: "19.3.1", "react-dom": "19.3.1" },
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
          jsx: "react-jsx",
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
    if (/@jsx(?:ImportSource|Runtime|Frag)?\b/.test(content)) problems.push(`${path}에서 @jsx 지시 주석을 쓸 수 없어요. 설치되지 않은 패키지를 끌어와 빌드가 실패해요.`);
    if (/\brequire\s*\(/.test(content)) problems.push(`${path}에서 require를 쓸 수 없어요. react, next, 프로젝트 안의 파일만 import로 가져와요.`);
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
기본 판단: 만들 수 없다고 확실한 이유가 Spec에 적혀 있을 때만 supported를 false로 합니다. 애매하면 true입니다.
판정 대상은 첫 Spec의 result, scope, verification에 명시된 기능뿐입니다. 서비스 방향 문서는 배경일 뿐이어서, 거기에만 있고 첫 Spec에는 없는 기능(알림, 공유 등)은 판단하지 않습니다. "회원", "팀원" 같은 말이 있어도 첫 Spec이 다른 기기나 다른 사람의 화면을 명시하지 않으면 한 사람이 쓰는 화면으로 읽습니다.

만들 수 있는 것(supported: true):
- 한 화면 안에서 값을 입력하고, 선택하고, 계산하고, 목록으로 쌓아 보여 주는 것. 새로고침하면 사라져도 괜찮습니다.
- "기록한다", "저장 버튼을 누른다", "목록에 추가한다"는 같은 브라우저 안에서 보여 주고 다시 열어도 남기는 것(브라우저 저장소)으로 만들 수 있습니다. 데이터베이스나 서버가 필요하다는 뜻으로 읽지 않습니다.
- 한 사람이 한 화면에서 쓰는 것으로 읽을 수 있으면 만들 수 있습니다. "팀원", "참가자"가 나와도 한 사람이 이름을 입력해 보는 화면이면 true입니다.
- 체크리스트, 할 일 목록, 가계부 입력과 합계, 투표나 선택 결과 보기, 간단한 게임, 고정된 문구(칭찬 메시지 등)를 보여 주는 것.

만들 수 없는 것(supported: false):
- 다른 기기나 다른 사람의 화면에도 같은 데이터가 보여야 하는 것(서버 저장, 여러 사람이 각자 기기에서 함께 쓰는 것, 초대와 공유).
- 메일, 메신저, 문자, 푸시 같은 알림을 보내는 것, 정해진 시각에 자동으로 도는 예약 실행(매일 아침 7시 같은 것).
- 로그인과 사용자별 화면.
- 키나 계정 가입이 필요한 외부 서비스를 부르는 것: AI가 글을 써 주거나 요약하거나 추천하는 것, 사진 업로드와 분석, 지도·장소·맛집·카페 데이터, 박스오피스·날씨·대여소·문화행사 같은 공공 데이터(대부분 키가 필요합니다), 뉴스·시세 같은 외부 데이터 조회.

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
- 사용할 수 있는 파일은 app/page.tsx(꼭 필요)와 components/이름.tsx뿐입니다. 파일 이름은 영문 알파벳과 숫자만 쓰는 PascalCase(예: TodoItem.tsx)로 하고, 한글 파일 이름은 쓰지 않습니다. 그 밖의 파일은 이미 준비되어 있습니다.
- 파일 맨 위에 "use client";를 쓰고, React 상태(useState 등)만으로 한 화면에서 동작하게 만듭니다.
- react와 next, 프로젝트 안의 파일만 가져옵니다. 다른 패키지는 설치되어 있지 않습니다.
- 새로고침 뒤에도 남겨야 하는 값은 localStorage에 저장합니다. 단 서버 렌더링 중에는 window가 없으므로 useEffect 안에서만 읽고 씁니다.
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
