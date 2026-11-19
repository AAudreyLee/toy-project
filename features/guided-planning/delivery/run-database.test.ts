import { describe, expect, it } from "vitest";
import type { DeliveryState } from "../types";
import { runDelivery, type DeliveryApi } from "./run";
import { createDelivery, userFacingStage } from "./state";

const spec = { result: "r", scope: ["s"], verification: ["v"], notNow: "n" };
const direction = { oneLine: "o", usersSituation: "u", problemAlternatives: "p", promisedChange: "c", coreLoop: "l" };
const connection = { apiKey: "k", endpoint: "https://e", deployment: "d" };

type Reply = Record<string, unknown> & { ok: boolean };

function fakeApi(handlers: Record<string, (req: Record<string, unknown>) => Reply | Reply[]>) {
  const calls: Record<string, unknown>[] = [];
  const queues: Record<string, Reply[]> = {};
  const api: DeliveryApi = async (req) => {
    calls.push(req);
    const kind = String(req.kind);
    const h = handlers[kind];
    if (!h) throw new Error(`처리기가 없음: ${kind}`);
    const out = h(req);
    if (Array.isArray(out)) {
      queues[kind] ??= [...out];
      return (queues[kind].length > 1 ? queues[kind].shift() : queues[kind][0]) as never;
    }
    return out as never;
  };
  return { api, calls };
}

const happy = {
  generate: () => ({ ok: true, files: { "app/page.tsx": "page", "package.json": "{}" } }),
  repo: () => ({ ok: true, repo: { id: 7, owner: "octo", name: "my-repo", url: "https://github.com/octo/my-repo" } }),
  push: () => ({ ok: true }),
  project: () => ({ ok: true, projectId: "prj_1", projectName: "my-repo" }),
  deploy: () => ({ ok: true, deploymentId: "dpl_1", url: "https://my-repo.vercel.app" }),
  poll: () => ({ ok: true, state: "ready", url: "https://my-repo.vercel.app" }),
  verify: () => ({ ok: true }),
};
const withDb = {
  ...happy,
  "database-create": () => ({ ok: true, databaseId: "store_1" }),
  "database-connect": () => ({ ok: true }),
};

async function run(api: DeliveryApi, d: DeliveryState = createDelivery("a"), extra: Partial<Parameters<typeof runDelivery>[0]> = {}) {
  const changes: DeliveryState[] = [];
  const final = await runDelivery({
    api,
    delivery: d,
    spec,
    direction,
    connection,
    vercelToken: "vcp_x",
    repoName: "my-repo",
    onChange: (x) => changes.push(x),
    sleep: async () => {},
    ...extra,
  });
  return { final, changes };
}

describe("서버 저장 진행 상태", () => {
  it("새 진행 상태는 데이터베이스가 필요하지 않고 만든 것도 없다", () => {
    const d = createDelivery("a");
    expect(d.needsDatabase).toBe(false);
    expect(d.databaseId).toBeNull();
  });

  it("데이터베이스를 만드는 일은 '데이터베이스 만드는 중'으로 보인다", () => {
    expect(userFacingStage("database")).toBe("데이터베이스 만드는 중");
  });
});

describe("서버 저장(데이터베이스) 실행", () => {
  it("프로젝트를 만든 뒤 배포하기 전에 데이터베이스를 만들어 연결한다", async () => {
    const { api, calls } = fakeApi(withDb);
    const { final } = await run(api, createDelivery("a"), { needsDatabase: true });
    expect(calls.map((c) => c.kind)).toEqual(["generate", "repo", "push", "project", "database-create", "database-connect", "deploy", "poll", "verify"]);
    expect(calls[0]).toMatchObject({ kind: "generate", database: true });
    expect(calls[4]).toMatchObject({ kind: "database-create", projectId: "prj_1", name: "my-repo-db" });
    expect(final.databaseId).toBe("store_1");
    expect(final.needsDatabase).toBe(true);
    expect(final.done).toContain("database");
    expect(final.verified).toBe(true);
  });

  it("데이터베이스가 필요 없는 시스템은 데이터베이스 단계를 건너뛴다", async () => {
    const { api, calls } = fakeApi(happy);
    const { final } = await run(api);
    expect(calls.map((c) => c.kind)).not.toContain("database-create");
    expect(final.done).not.toContain("database");
  });

  it("진행하는 동안 데이터베이스 단계가 프로젝트와 배포 사이에 표시된다", async () => {
    const { api } = fakeApi(withDb);
    const { changes } = await run(api, createDelivery("a"), { needsDatabase: true });
    const running = changes.map((c) => c.running).filter(Boolean);
    expect(running.indexOf("project")).toBeLessThan(running.indexOf("database"));
    expect(running.indexOf("database")).toBeLessThan(running.indexOf("deploy"));
  });

  it("Neon이 설치되어 있지 않으면 거기서 멈추고, 설치한 뒤 다시 시도하면 코드와 저장소는 다시 만들지 않는다", async () => {
    let installed = false;
    const { api, calls } = fakeApi({
      ...withDb,
      "database-create": () => (installed ? { ok: true, databaseId: "store_1" } : { ok: false, code: "neon-missing", message: "Neon을 설치해 주세요" }),
    });
    const first = await run(api, createDelivery("a"), { needsDatabase: true });
    expect(first.final.error).toMatchObject({ step: "database", code: "neon-missing" });
    expect(first.final.done).toEqual(expect.arrayContaining(["generate", "repo", "push", "project"]));
    installed = true;
    const second = await run(api, first.final, { needsDatabase: true });
    expect(second.final.verified).toBe(true);
    expect(calls.filter((c) => c.kind === "generate")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "repo")).toHaveLength(1);
  });

  it("연결에 실패해도 만든 데이터베이스 ID를 남기고, 다시 시도하면 새로 만들지 않고 이어서 연결한다", async () => {
    let connectOk = false;
    const { api, calls } = fakeApi({
      ...withDb,
      "database-connect": () => (connectOk ? { ok: true } : { ok: false, code: "failed", message: "연결하지 못했어요" }),
    });
    const first = await run(api, createDelivery("a"), { needsDatabase: true });
    expect(first.final.error).toMatchObject({ step: "database" });
    expect(first.final.databaseId).toBe("store_1");
    connectOk = true;
    const second = await run(api, first.final, { needsDatabase: true });
    expect(second.final.verified).toBe(true);
    expect(calls.filter((c) => c.kind === "database-create")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "database-connect")).toHaveLength(2);
  });

  it("빌드 실패를 자동으로 고칠 때도 서버 저장 규칙으로 고친다", async () => {
    const { api, calls } = fakeApi({
      ...withDb,
      poll: () => [
        { ok: true, state: "error", url: "u", buildLog: "x", reason: "" },
        { ok: true, state: "ready", url: "https://my-repo.vercel.app" },
      ],
      fix: () => ({ ok: true, files: { "app/page.tsx": "fixed" } }),
    });
    await run(api, createDelivery("a"), { needsDatabase: true });
    expect(calls.find((c) => c.kind === "fix")).toMatchObject({ database: true });
  });
});
