import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixFiles, generateFiles, judgeSupport, starterFiles, validateGenerated } from "./generate";

const connection = { apiKey: "K", endpoint: "https://r.openai.azure.com", deployment: "d" };
const spec = { result: "동네를 고르면 오늘 미세먼지가 화면에 보인다", scope: ["동네를 고른다", "미세먼지를 본다"], verification: ["동네를 고르면 수치가 화면에 보인다"], notNow: "알림" };
const direction = { oneLine: "미세먼지 확인", usersSituation: "직장인", problemAlternatives: "앱을 안 엶", promisedChange: "한눈에 확인", coreLoop: "고른다, 본다" };

function azure(...contents: string[]) {
  let i = 0;
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: contents[Math.min(i++, contents.length - 1)] } }] }), { status: 200 }));
}
const goodPage = `"use client";\nimport { useState } from "react";\nexport default function Page() { const [a] = useState(1); return <main>{a}</main>; }\n`;
const filesJson = (files: Record<string, string>) => JSON.stringify({ files });

describe("시작 코드", () => {
  it("빌드에 필요한 파일을 갖추고 저장소 이름을 패키지 이름으로 쓴다", () => {
    const files = starterFiles("my-repo");
    for (const p of ["package.json", "tsconfig.json", "next.config.mjs", "app/layout.tsx", "app/globals.css", ".gitignore", "README.md"]) expect(files).toHaveProperty([p]);
    expect(JSON.parse(files["package.json"]).name).toBe("my-repo");
    expect(JSON.parse(files["package.json"]).dependencies).toMatchObject({ next: expect.any(String), react: expect.any(String) });
  });

  it("Next.js와 React 버전은 이 프로젝트가 쓰는 정확한 버전과 같다(Vercel은 취약한 버전의 배포를 거부한다)", () => {
    const own = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).dependencies;
    const deps = JSON.parse(starterFiles("my-repo")["package.json"]).dependencies;
    expect(deps.next).toBe(own.next);
    expect(deps.react).toBe(own.react);
    expect(deps["react-dom"]).toBe(own["react-dom"]);
  });
});

describe("생성된 코드 검사", () => {
  it("app/page.tsx와 components 아래 파일만 허용한다", () => {
    expect(validateGenerated({ "app/page.tsx": goodPage })).toEqual([]);
    expect(validateGenerated({ "app/page.tsx": goodPage, "components/A.tsx": goodPage })).toEqual([]);
    expect(validateGenerated({ "app/page.tsx": goodPage, "package.json": "{}" }).join()).toContain("package.json");
    expect(validateGenerated({ "components/A.tsx": goodPage }).join()).toContain("app/page.tsx");
    expect(validateGenerated({ "app/page.tsx": goodPage, "../evil.ts": "x" }).join()).toContain("../evil.ts");
  });

  it("react, next, 같은 폴더의 파일만 가져올 수 있고 다른 패키지는 안 된다", () => {
    const withLib = goodPage + 'import _ from "lodash";\n';
    expect(validateGenerated({ "app/page.tsx": withLib }).join()).toContain("lodash");
    const rel = goodPage + 'import X from "../components/A";\n';
    expect(validateGenerated({ "app/page.tsx": rel, "components/A.tsx": goodPage })).toEqual([]);
  });

  it("import 문 없이 다른 패키지를 끌어오는 JSX 지시 주석과 require도 안 된다(설치되지 않은 패키지 오류의 원인)", () => {
    const pragma = "/** @jsxImportSource @emotion/react */\n" + goodPage;
    expect(validateGenerated({ "app/page.tsx": pragma }).join()).toContain("@jsx");
    expect(validateGenerated({ "app/page.tsx": goodPage + 'const x = require("lodash");\n' }).join()).toContain("require");
  });

  it("환경 변수와 비밀 값을 쓰면 안 된다", () => {
    expect(validateGenerated({ "app/page.tsx": goodPage + "const k = process.env.SECRET;\n" }).join()).toContain("환경 변수");
  });

  it("비어 있거나 너무 큰 파일은 안 된다", () => {
    expect(validateGenerated({ "app/page.tsx": "  " }).length).toBeGreaterThan(0);
    expect(validateGenerated({ "app/page.tsx": "x".repeat(60_000) }).length).toBeGreaterThan(0);
  });
});

describe("지원 범위 판정", () => {
  it("키가 필요 없는 시스템은 구현을 시작할 수 있다고 판정한다", async () => {
    const res = await judgeSupport(connection, spec, direction, azure(JSON.stringify({ supported: true, reason: "", hint: "" })));
    expect(res).toEqual({ supported: true, reason: "", hint: "" });
  });

  it("저장이나 알림 발송이 필요하면 이유와 고치는 방법을 돌려준다", async () => {
    const f = azure(JSON.stringify({ supported: false, reason: "메일 발송에는 별도 계정이 필요해요", hint: "화면에 보여 주는 것으로 줄여 보세요" }));
    const res = await judgeSupport(connection, { ...spec, result: "매일 메일로 받는다" }, direction, f);
    expect(res.supported).toBe(false);
    expect(res.reason).toContain("메일");
    expect(res.hint).toBeTruthy();
  });

  it("Spec 내용을 판정 요청에 담는다", async () => {
    const f = azure(JSON.stringify({ supported: true, reason: "", hint: "" }));
    await judgeSupport(connection, spec, direction, f);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(JSON.stringify(body.messages)).toContain("동네를 고르면");
  });

  it("판정이 형식에 맞지 않으면 구현을 막지 않고 오류로 알린다", async () => {
    await expect(judgeSupport(connection, spec, direction, azure("판정 불가"))).rejects.toMatchObject({ code: "failed" });
  });
});

describe("코드 생성", () => {
  it("시작 코드에 생성한 페이지를 합쳐 돌려준다", async () => {
    const files: Record<string, string> = await generateFiles(connection, { spec, direction, repoName: "r" }, azure(filesJson({ "app/page.tsx": goodPage })));
    expect(files["app/page.tsx"]).toBe(goodPage);
    expect(files["package.json"]).toBeTruthy();
  });

  it("허용되지 않는 코드가 나오면 이유를 알려 주고 다시 받고, 고쳐지면 그 결과를 쓴다", async () => {
    const bad = filesJson({ "app/page.tsx": goodPage + 'import _ from "lodash";\n' });
    const f = azure(bad, filesJson({ "app/page.tsx": goodPage }));
    const files = await generateFiles(connection, { spec, direction, repoName: "r" }, f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(files["app/page.tsx"]).toBe(goodPage);
    const retry = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).messages.at(-1).content as string;
    expect(retry).toContain("lodash");
  });

  it("두 번 다시 받아도 어긋나면 오류로 알린다", async () => {
    const bad = filesJson({ "app/page.tsx": goodPage + 'import _ from "lodash";\n' });
    await expect(generateFiles(connection, { spec, direction, repoName: "r" }, azure(bad))).rejects.toMatchObject({ code: "failed" });
  });

  it("키 문제는 Azure 키 문제로 구분해 알린다", async () => {
    const denied = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(generateFiles(connection, { spec, direction, repoName: "r" }, denied)).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("키") });
  });
});

describe("빌드 실패 고치기", () => {
  it("빌드 로그와 현재 코드를 보내고, 고친 파일로 바꿔 돌려준다", async () => {
    const current: Record<string, string> = { ...starterFiles("r"), "app/page.tsx": goodPage };
    const fixed = goodPage.replace("useState(1)", "useState(2)");
    const f = azure(filesJson({ "app/page.tsx": fixed }));
    const files = await fixFiles(connection, { files: current, buildLog: "Type error: x is not defined" }, f);
    expect(files["app/page.tsx"]).toBe(fixed);
    expect(files["package.json"]).toBe(current["package.json"]);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(JSON.stringify(body.messages)).toContain("x is not defined");
  });
});
