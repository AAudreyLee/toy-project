import { describe, expect, it, vi } from "vitest";
import { handleDeliveryRequest } from "./server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const connection = { apiKey: "AZ-SECRET", endpoint: "https://r.openai.azure.com", deployment: "d" };
const spec = { result: "r", scope: ["s"], verification: ["v"], notNow: "n" };
const direction = { oneLine: "o", usersSituation: "u", problemAlternatives: "p", promisedChange: "c", coreLoop: "l" };

function router(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [prefix, h] of Object.entries(routes)) if (String(url).startsWith(prefix)) return h(init);
    return json({ message: `unexpected ${url}` }, 500);
  });
  return { f: f as unknown as typeof fetch, calls };
}
const azureReply = (content: unknown) => json({ choices: [{ message: { content: JSON.stringify(content) } }] });

const vercelRoutes = {
  "https://api.vercel.com/v9/projects/prj_1": () => json({ accountId: "team_a" }),
  "https://api.vercel.com/v1/integrations/configurations": () => json([{ id: "icfg_1", slug: "neon" }]),
  "https://api.vercel.com/v1/storage/stores/integration/direct": () => json({ store: { id: "store_1" } }),
  "https://api.vercel.com/v1/integrations/installations/icfg_1/resources/store_1/connections": () => new Response(null, { status: 201 }),
};

describe("서버 저장(데이터베이스) 서버 요청", () => {
  it("지원 범위 판정에 데이터베이스 필요 여부가 담긴다", async () => {
    const { f } = router({ "https://r.openai.azure.com": () => azureReply({ supported: true, needsDatabase: true, reason: "", hint: "" }) });
    const res = await handleDeliveryRequest({ kind: "plan", connection, spec, direction }, {}, f);
    expect(res).toMatchObject({ ok: true, supported: true, needsDatabase: true });
  });

  it("데이터베이스가 필요한 시스템은 서버 코드 파일이 담긴 코드를 만들 수 있다", async () => {
    const page = '"use client";\nexport default function P() { return <main>x</main>; }\n';
    const route = 'import { neon } from "@neondatabase/serverless";\nconst sql = neon(process.env.DATABASE_URL!);\nexport async function GET() { return Response.json(await sql`select 1`); }\n';
    const { f } = router({ "https://r.openai.azure.com": () => azureReply({ files: { "app/page.tsx": page, "app/api/items/route.ts": route } }) });
    const res = await handleDeliveryRequest({ kind: "generate", connection, spec, direction, repoName: "r", database: true }, {}, f);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect(Object.keys(res.files as object)).toContain("app/api/items/route.ts");
  });

  it("데이터베이스를 만들어 ID를 돌려주고, 프로젝트가 속한 팀으로 요청한다", async () => {
    const { f, calls } = router(vercelRoutes);
    const res = await handleDeliveryRequest({ kind: "database-create", vercelToken: "vcp_t", projectId: "prj_1", name: "r-db" }, {}, f);
    expect(res).toEqual({ ok: true, databaseId: "store_1" });
    const create = calls.find((c) => c.url.includes("/integration/direct"))!;
    expect(create.url).toContain("teamId=team_a");
    expect((create.init!.headers as Record<string, string>).Authorization).toBe("Bearer vcp_t");
  });

  it("Neon이 설치되어 있지 않으면 데이터베이스를 만들지 않고 설치 안내로 알린다", async () => {
    const { f, calls } = router({ ...vercelRoutes, "https://api.vercel.com/v1/integrations/configurations": () => json([]) });
    const res = await handleDeliveryRequest({ kind: "database-create", vercelToken: "t", projectId: "prj_1", name: "n" }, {}, f);
    expect(res).toMatchObject({ ok: false, code: "neon-missing" });
    expect(calls.some((c) => c.url.includes("/integration/direct"))).toBe(false);
  });

  it("만든 데이터베이스를 프로젝트에 연결한다", async () => {
    const { f, calls } = router(vercelRoutes);
    const res = await handleDeliveryRequest({ kind: "database-connect", vercelToken: "t", projectId: "prj_1", databaseId: "store_1" }, {}, f);
    expect(res).toEqual({ ok: true });
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toMatchObject({ projectId: "prj_1" });
  });

  it("Vercel 토큰이나 프로젝트가 없으면 Vercel을 부르지 않고 오류로 알린다", async () => {
    const { f, calls } = router({});
    expect(await handleDeliveryRequest({ kind: "database-create", projectId: "prj_1", name: "n" }, {}, f)).toMatchObject({ ok: false, code: "vercel-auth" });
    expect(await handleDeliveryRequest({ kind: "database-connect", vercelToken: "t", databaseId: "s" }, {}, f)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("이미 연결된 데이터베이스는 다시 연결하지 않고 성공으로 돌려준다(다시 시도해도 막히지 않게)", async () => {
    // 가짜 fetch는 접두어 순서대로 맞추므로 더 긴 경로를 먼저 둔다.
    const { f, calls } = router({
      "https://api.vercel.com/v9/projects/prj_1/env": () => json({ envs: [{ key: "DATABASE_URL", contentHint: { storeId: "store_1" } }] }),
      ...vercelRoutes,
    });
    const res = await handleDeliveryRequest({ kind: "database-connect", vercelToken: "t", projectId: "prj_1", databaseId: "store_1" }, {}, f);
    expect(res).toEqual({ ok: true });
    expect(calls.some((c) => c.url.includes("/connections"))).toBe(false);
  });
});
