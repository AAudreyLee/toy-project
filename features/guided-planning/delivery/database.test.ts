import { describe, expect, it, vi } from "vitest";
import { connectDatabase, createDatabase, findNeon, getProjectOwner, isDatabaseConnected } from "./database";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
type Call = [string, RequestInit | undefined];
const calls = (f: unknown) => (f as { mock: { calls: Call[] } }).mock.calls;

describe("프로젝트 소유 팀", () => {
  it("프로젝트가 팀 소유면 팀 ID를 돌려주고, 개인 소유면 null을 돌려준다", async () => {
    const team = vi.fn(async () => json({ accountId: "team_abc" }));
    await expect(getProjectOwner("t", "prj_1", team as unknown as typeof fetch)).resolves.toBe("team_abc");
    expect(calls(team)[0][0]).toContain("/v9/projects/prj_1");
    const user = vi.fn(async () => json({ accountId: "usr_1" }));
    await expect(getProjectOwner("t", "prj_1", user as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("프로젝트를 읽지 못하면 연결 문제로 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "forbidden" } }, 403));
    await expect(getProjectOwner("t", "prj_1", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "vercel-auth" });
  });
});

describe("Neon 연동 확인", () => {
  it("설치되어 있으면 연동 ID를 돌려주고 팀 ID를 요청에 붙인다", async () => {
    const f = vi.fn(async () => json([{ id: "icfg_1", slug: "neon" }]));
    await expect(findNeon("t", "team_abc", f as unknown as typeof fetch)).resolves.toEqual({ id: "icfg_1" });
    expect(calls(f)[0][0]).toContain("teamId=team_abc");
    expect(calls(f)[0][0]).toContain("integrationIdOrSlug=neon");
  });

  it("설치되어 있지 않으면 설치 방법을 담은 neon-missing 오류로 알린다", async () => {
    const f = vi.fn(async () => json([]));
    await expect(findNeon("t", null, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "neon-missing", message: expect.stringContaining("Neon") });
    expect(calls(f)[0][0]).not.toContain("teamId");
  });

  it("다른 연동만 있으면 설치되지 않은 것으로 본다", async () => {
    const f = vi.fn(async () => json([{ id: "icfg_9", slug: "upstash" }]));
    await expect(findNeon("t", "team_abc", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "neon-missing" });
  });

  it("토큰이 거부되면 Vercel 연결 문제로 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "forbidden", invalidToken: true } }, 403));
    await expect(findNeon("t", null, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "vercel-auth" });
  });
});

describe("데이터베이스 만들기", () => {
  it("무료 플랜으로 지역과 이름을 정해 만들고 연결에 쓸 ID를 돌려준다(인증 기능은 끈다)", async () => {
    const f = vi.fn(async () => json({ store: { id: "store_1", externalResourceId: "ext" } }));
    await expect(createDatabase("t", { teamId: "team_abc", configurationId: "icfg_1", name: "my-repo-db" }, f as unknown as typeof fetch)).resolves.toEqual({ id: "store_1" });
    const [url, init] = calls(f)[0];
    expect(url).toContain("/v1/storage/stores/integration/direct");
    expect(url).toContain("teamId=team_abc");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ name: "my-repo-db", integrationConfigurationId: "icfg_1", integrationProductIdOrSlug: "neon", metadata: { auth: false } });
    expect(body.metadata.region).toBeTruthy();
    expect(body).not.toHaveProperty("billingPlanId");
  });

  it("결제 수단이 필요하다는 응답(402)은 원인과 해결 방법을 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "payment_required" } }, 402));
    await expect(createDatabase("t", { teamId: null, configurationId: "i", name: "n" }, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("결제") });
  });

  it("한도나 이름 충돌 같은 그 밖의 거부는 상태 코드와 함께 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "limit", message: "Maximum projects reached" } }, 400));
    await expect(createDatabase("t", { teamId: null, configurationId: "i", name: "n" }, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("400") });
  });

  it("응답에 store가 없으면 실패로 본다", async () => {
    const f = vi.fn(async () => json({ store: null }));
    await expect(createDatabase("t", { teamId: null, configurationId: "i", name: "n" }, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "failed" });
  });
});

describe("데이터베이스를 배포 프로젝트에 연결", () => {
  it("모든 환경에 연결해 접속 정보가 환경 변수로 들어가게 한다", async () => {
    const f = vi.fn(async () => new Response(null, { status: 201 }));
    await connectDatabase("t", { teamId: "team_abc", configurationId: "icfg_1", databaseId: "store_1", projectId: "prj_1" }, f as unknown as typeof fetch);
    const [url, init] = calls(f)[0];
    expect(url).toContain("/v1/integrations/installations/icfg_1/resources/store_1/connections");
    expect(url).toContain("teamId=team_abc");
    expect(JSON.parse(String(init?.body))).toEqual({ projectId: "prj_1", envVarEnvironments: ["production", "preview", "development"] });
  });

  it("이미 연결되어 있다는 응답은 성공으로 본다(다시 시도해도 중복으로 막히지 않게)", async () => {
    const f = vi.fn(async () => json({ error: { code: "env_var_prefix_not_unique", message: "already connected" } }, 400));
    await expect(connectDatabase("t", { teamId: null, configurationId: "i", databaseId: "s", projectId: "p" }, f as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("연결이 거부되면 실패로 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "not_found" } }, 404));
    await expect(connectDatabase("t", { teamId: null, configurationId: "i", databaseId: "s", projectId: "p" }, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("404") });
  });
});

describe("이미 연결됐는지 확인", () => {
  const ids = { teamId: "team_abc", projectId: "prj_1", databaseId: "store_1" };

  it("프로젝트 환경 변수 중 이 데이터베이스에서 온 것이 있으면 연결된 것으로 본다", async () => {
    const f = vi.fn(async () => json({ envs: [{ key: "A", contentHint: { type: "integration-store-secret", storeId: "store_other" } }, { key: "DATABASE_URL", contentHint: { type: "integration-store-secret", storeId: "store_1" } }] }));
    await expect(isDatabaseConnected("t", ids, f as unknown as typeof fetch)).resolves.toBe(true);
    expect(calls(f)[0][0]).toContain("/v9/projects/prj_1/env");
    expect(calls(f)[0][0]).toContain("teamId=team_abc");
  });

  it("이 데이터베이스에서 온 환경 변수가 없으면 연결되지 않은 것으로 본다", async () => {
    const f = vi.fn(async () => json({ envs: [{ key: "A" }, { key: "B", contentHint: { storeId: "store_other" } }] }));
    await expect(isDatabaseConnected("t", ids, f as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("환경 변수를 읽지 못하면 연결 여부를 모르는 것으로 보고 연결 시도로 넘어간다", async () => {
    const f = vi.fn(async () => json({ error: { code: "forbidden" } }, 403));
    await expect(isDatabaseConnected("t", ids, f as unknown as typeof fetch)).resolves.toBe(false);
  });
});
