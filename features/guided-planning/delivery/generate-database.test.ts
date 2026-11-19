import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixFiles, generateFiles, judgeSupport, starterFiles, validateGenerated } from "./generate";

const connection = { apiKey: "K", endpoint: "https://r.openai.azure.com", deployment: "d" };
const spec = { result: "팀원 모두가 같은 공지 목록을 본다", scope: ["공지를 쓴다", "목록을 본다"], verification: ["다른 브라우저에서도 공지가 보인다"], notNow: "로그인" };
const direction = { oneLine: "공지판", usersSituation: "팀", problemAlternatives: "메신저", promisedChange: "한 곳에서 확인", coreLoop: "쓴다, 본다" };

function azure(...contents: string[]) {
  let i = 0;
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: contents[Math.min(i++, contents.length - 1)] } }] }), { status: 200 }));
}
const filesJson = (files: Record<string, string>) => JSON.stringify({ files });

const goodPage = `"use client";\nimport { useEffect, useState } from "react";\nexport default function Page() { const [a, setA] = useState<string[]>([]); useEffect(() => { void fetch("/api/notices").then((r) => r.json()).then(setA); }, []); return <main>{a.length}</main>; }\n`;
const goodRoute = `import { neon } from "@neondatabase/serverless";\nexport const dynamic = "force-dynamic";\nconst sql = neon(process.env.DATABASE_URL!);\nexport async function GET() { await sql\`CREATE TABLE IF NOT EXISTS notices (id serial primary key, text text)\`; const rows = await sql\`SELECT text FROM notices\`; return Response.json(rows); }\n`;
const db = { database: true };

describe("서버 저장 시스템의 시작 코드", () => {
  it("데이터베이스가 필요하면 Neon 접속 패키지를 정확한 버전으로 넣고, 필요 없으면 넣지 않는다", () => {
    const withDb = JSON.parse(starterFiles("r", db)["package.json"]).dependencies;
    expect(withDb["@neondatabase/serverless"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(starterFiles("r")["package.json"]).dependencies).not.toHaveProperty("@neondatabase/serverless");
  });

  it("Next.js와 React 버전은 그대로 이 프로젝트와 같다", () => {
    const own = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).dependencies;
    const deps = JSON.parse(starterFiles("r", db)["package.json"]).dependencies;
    expect(deps.next).toBe(own.next);
    expect(deps.react).toBe(own.react);
  });
});

describe("서버 저장 시스템의 코드 검사", () => {
  it("서버 코드 파일(app/api/이름/route.ts, lib/이름.ts)을 허용하되 데이터베이스가 필요할 때만 허용한다", () => {
    const files = { "app/page.tsx": goodPage, "app/api/notices/route.ts": goodRoute };
    expect(validateGenerated(files, db)).toEqual([]);
    expect(validateGenerated(files).join()).toContain("app/api/notices/route.ts");
    expect(validateGenerated({ ...files, "lib/db.ts": 'import { neon } from "@neondatabase/serverless";\nexport const sql = neon(process.env.DATABASE_URL!);\n' }, db)).toEqual([]);
  });

  it("서버 코드에서는 DATABASE_URL만 읽을 수 있고 다른 환경 변수는 안 된다", () => {
    const other = goodRoute + "const x = process.env.SECRET_KEY;\n";
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/notices/route.ts": other }, db).join()).toContain("SECRET_KEY");
  });

  it("화면 코드(page, components)에서는 환경 변수, 데이터베이스 패키지, lib 가져오기가 모두 안 된다(비밀 키가 브라우저로 내려가지 않게)", () => {
    const route = { "app/api/notices/route.ts": goodRoute };
    for (const leak of ['const u = process.env.DATABASE_URL;\n', 'import { neon } from "@neondatabase/serverless";\n', 'import { sql } from "@/lib/db";\n', 'import { sql } from "../lib/db";\n']) {
      expect(validateGenerated({ ...route, "app/page.tsx": goodPage + leak }, db).length, leak).toBeGreaterThan(0);
      expect(validateGenerated({ ...route, "app/page.tsx": goodPage, "components/A.tsx": goodPage + leak }, db).length, leak).toBeGreaterThan(0);
    }
  });

  it("서버 코드에서도 다른 패키지는 안 되고 next/server와 같은 프로젝트 파일만 가져올 수 있다", () => {
    const bad = goodRoute + 'import _ from "lodash";\n';
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/notices/route.ts": bad }, db).join()).toContain("lodash");
    const ok = goodRoute + 'import { NextResponse } from "next/server";\nimport { sql } from "../../../lib/db";\n';
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/notices/route.ts": ok, "lib/db.ts": "export const sql = 1;\n" }, db)).toEqual([]);
  });

  it("서버 코드 맨 바깥에서 await를 쓰면 안 된다(빌드할 때 데이터베이스에 접속해 빌드가 데이터베이스에 묶인다)", () => {
    const topLevel = goodRoute.replace("export async function GET", 'await sql`CREATE TABLE IF NOT EXISTS t (id int)`;\nexport async function GET');
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/notices/route.ts": topLevel }, db).join()).toContain("await");
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/notices/route.ts": goodRoute }, db)).toEqual([]);
  });

  it("route.ts는 깊이 한 단계 이름만 쓸 수 있다", () => {
    expect(validateGenerated({ "app/page.tsx": goodPage, "app/api/a/b/route.ts": goodRoute }, db).join()).toContain("app/api/a/b/route.ts");
  });
});

describe("서버 저장 시스템의 코드 생성", () => {
  it("서버 저장 규칙으로 요청하고, 서버 코드가 담긴 결과를 시작 코드와 합쳐 돌려준다", async () => {
    const f = azure(filesJson({ "app/page.tsx": goodPage, "app/api/notices/route.ts": goodRoute }));
    const files = await generateFiles(connection, { spec, direction, repoName: "r", database: true }, f);
    expect(files["app/api/notices/route.ts"]).toBe(goodRoute);
    expect(JSON.parse(files["package.json"]).dependencies["@neondatabase/serverless"]).toBeTruthy();
    const sys = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages[0].content as string;
    expect(sys).toContain("DATABASE_URL");
    expect(sys).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("데이터베이스가 필요 없는 시스템에는 서버 저장 규칙을 붙이지 않는다", async () => {
    const f = azure(filesJson({ "app/page.tsx": goodPage.replace('fetch("/api/notices")', 'fetch("/x")') }));
    await generateFiles(connection, { spec, direction, repoName: "r" }, f);
    const sys = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages[0].content as string;
    expect(sys).not.toContain("DATABASE_URL");
  });

  it("빌드 실패를 고칠 때도 서버 코드 파일을 함께 고칠 수 있다", async () => {
    const current: Record<string, string> = { ...starterFiles("r", db), "app/page.tsx": goodPage, "app/api/notices/route.ts": goodRoute };
    const fixedRoute = goodRoute.replace("text text", "text text not null");
    const f = azure(filesJson({ "app/api/notices/route.ts": fixedRoute, "app/page.tsx": goodPage }));
    const files = await fixFiles(connection, { files: current, buildLog: "Type error", database: true }, f);
    expect(files["app/api/notices/route.ts"]).toBe(fixedRoute);
    const body = JSON.stringify(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages);
    expect(body).toContain("app/api/notices/route.ts");
  });
});

describe("서버 저장 판정", () => {
  it("모두가 같은 데이터를 보는 시스템은 만들 수 있고 데이터베이스가 필요하다고 판정한다", async () => {
    const res = await judgeSupport(connection, spec, direction, azure(JSON.stringify({ supported: true, needsDatabase: true, reason: "", hint: "" })));
    expect(res).toEqual({ supported: true, needsDatabase: true, reason: "", hint: "" });
  });

  it("같은 브라우저에 남으면 충분한 시스템은 데이터베이스가 필요 없다고 판정한다", async () => {
    const res = await judgeSupport(connection, spec, direction, azure(JSON.stringify({ supported: true, needsDatabase: false, reason: "", hint: "" })));
    expect(res.needsDatabase).toBe(false);
  });

  it("needsDatabase가 빠진 응답은 데이터베이스가 필요 없는 것으로 읽는다", async () => {
    const res = await judgeSupport(connection, spec, direction, azure(JSON.stringify({ supported: true, reason: "", hint: "" })));
    expect(res.needsDatabase).toBe(false);
  });

  it("막아야 하는 Spec은 데이터베이스가 필요하다고 답해도 필요 없음으로 돌려준다", async () => {
    const res = await judgeSupport(connection, spec, direction, azure(JSON.stringify({ supported: false, needsDatabase: true, reason: "로그인이 필요해요", hint: "공유 목록으로 줄여 보세요" })));
    expect(res).toMatchObject({ supported: false, needsDatabase: false });
  });
});
