import { describe, expect, it, vi } from "vitest";
import type { DeliveryState } from "../types";
import { runDelivery, type DeliveryApi } from "./run";
import { createDelivery } from "./state";

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

describe("구현과 배포 실행", () => {
  it("코드 만들기, 저장소 만들기, 올리기, 프로젝트 만들기, 배포, 확인을 순서대로 하고 주소를 남긴다", async () => {
    const { api, calls } = fakeApi(happy);
    const { final } = await run(api);
    expect(calls.map((c) => c.kind)).toEqual(["generate", "repo", "push", "project", "deploy", "poll", "verify"]);
    expect(final.repoUrl).toBe("https://github.com/octo/my-repo");
    expect(final.deployUrl).toBe("https://my-repo.vercel.app");
    expect(final.verified).toBe(true);
    expect(final.error).toBeNull();
    expect(final.done).toEqual(expect.arrayContaining(["generate", "repo", "push", "project", "deploy", "verify"]));
  });

  it("진행하는 동안 지금 하는 일이 바뀌는 상태를 순서대로 알린다", async () => {
    const { api } = fakeApi(happy);
    const { changes } = await run(api);
    const running = changes.map((c) => c.running).filter(Boolean);
    expect(running).toEqual(expect.arrayContaining(["generate", "repo", "push", "project", "deploy", "verify"]));
    expect(running.indexOf("generate")).toBeLessThan(running.indexOf("repo"));
    expect(running.indexOf("push")).toBeLessThan(running.indexOf("deploy"));
  });

  it("저장소 이름이 이미 있으면 거기서 멈추고 이름을 바꾸라고 알린다. 코드는 다시 만들지 않는다", async () => {
    const { api } = fakeApi({ ...happy, repo: () => ({ ok: false, code: "name-taken", message: "이미 있어요" }) });
    const { final } = await run(api);
    expect(final.error).toMatchObject({ step: "repo", code: "name-taken" });
    expect(final.done).toEqual(["generate"]);
    expect(final.repoUrl).toBeNull();
    const retry = fakeApi({ ...happy, generate: () => { throw new Error("다시 만들면 안 돼요"); } });
    const { final: second } = await run(retry.api, final, { repoName: "other" });
    expect(second.verified).toBe(true);
    expect(retry.calls.find((c) => c.kind === "repo")).toMatchObject({ repoName: "other" });
  });

  it("다시 시도하면 이미 끝낸 단계는 건너뛰고 실패한 단계부터 이어서 한다", async () => {
    let pushes = 0;
    const first = fakeApi({ ...happy, push: () => (++pushes === 1 ? { ok: false, code: "failed", message: "올리기 실패" } : { ok: true }) });
    const { final } = await run(first.api);
    expect(final.error?.step).toBe("push");
    expect(final.repoUrl).toBeTruthy();
    const second = fakeApi(happy);
    const { final: done } = await run(second.api, final);
    expect(second.calls.map((c) => c.kind)).toEqual(["push", "project", "deploy", "poll", "verify"]);
    expect(done.verified).toBe(true);
  });

  it("Vercel이 저장소를 볼 수 없으면 프로젝트 단계에서 멈추고 해결 후 같은 단계부터 이어 간다", async () => {
    const { api } = fakeApi({ ...happy, project: () => ({ ok: false, code: "vercel-git", message: "Vercel 앱 필요" }) });
    const { final } = await run(api);
    expect(final.error).toMatchObject({ step: "project", code: "vercel-git" });
    expect(final.repoUrl).toBeTruthy();
    expect(final.done).toEqual(expect.arrayContaining(["generate", "repo", "push"]));
  });

  it("배포 빌드가 실패하면 로그로 코드를 고쳐 다시 올리고 다시 배포한다(최대 2번)", async () => {
    const polls: Reply[] = [{ ok: true, state: "error", url: "u", buildLog: "Type error" }, { ok: true, state: "ready", url: "https://my-repo.vercel.app" }];
    const { api, calls } = fakeApi({ ...happy, poll: () => polls, fix: () => ({ ok: true, files: { "app/page.tsx": "fixed" } }) });
    const { final } = await run(api);
    const kinds = calls.map((c) => c.kind);
    expect(kinds).toContain("fix");
    expect(kinds.filter((k) => k === "deploy")).toHaveLength(2);
    expect(calls.find((c) => c.kind === "fix")).toMatchObject({ buildLog: "Type error" });
    expect(calls.filter((c) => c.kind === "push").at(-1)).toMatchObject({ update: true });
    expect(final.fixAttempts).toBe(1);
    expect(final.verified).toBe(true);
  });

  it("두 번 고쳐도 빌드가 실패하면 원인을 알리고 멈춘다. 저장소는 남는다", async () => {
    const { api, calls } = fakeApi({
      ...happy,
      poll: () => ({ ok: true, state: "error", url: "u", buildLog: "Type error: still broken" }),
      fix: () => ({ ok: true, files: { "app/page.tsx": "x" } }),
    });
    const { final } = await run(api);
    expect(calls.filter((c) => c.kind === "fix")).toHaveLength(2);
    expect(final.fixAttempts).toBe(2);
    expect(final.error).toMatchObject({ step: "deploy", code: "build" });
    expect(final.error?.message).toContain("still broken");
    expect(final.repoUrl).toBeTruthy();
    expect(final.verified).toBe(false);
  });

  it("코드로 고칠 수 없는 배포 거부(취약한 Next.js 버전)는 고치려 하지 않고 이유를 그대로 알린다", async () => {
    const { api, calls } = fakeApi({ ...happy, poll: () => ({ ok: true, state: "error", url: "u", buildLog: "Build Completed", reason: "Vulnerable version of Next.js detected, please update immediately." }) });
    const { final } = await run(api);
    expect(calls.map((c) => c.kind)).not.toContain("fix");
    expect(final.error).toMatchObject({ step: "deploy", code: "build" });
    expect(final.error?.message).toContain("Vulnerable");
    expect(final.fixAttempts).toBe(0);
  });

  it("배포 주소가 정상 응답을 주지 않으면 완료로 표시하지 않는다", async () => {
    const { api } = fakeApi({ ...happy, verify: () => ({ ok: false, code: "failed", message: "응답이 없어요" }) });
    const { final } = await run(api);
    expect(final.verified).toBe(false);
    expect(final.error).toMatchObject({ step: "verify" });
  });

  it("배포가 너무 오래 걸리면 시간 초과로 알린다", async () => {
    const { api } = fakeApi({ ...happy, poll: () => ({ ok: true, state: "pending", url: "u" }) });
    const sleep = vi.fn(async () => {});
    const { final } = await run(api, createDelivery("a"), { sleep, maxPolls: 3 });
    expect(final.error).toMatchObject({ step: "deploy", code: "failed" });
    expect(sleep).toHaveBeenCalled();
  });

  it("API가 던진 예외도 실패로 정리해 알린다", async () => {
    const api: DeliveryApi = async () => {
      throw new Error("network");
    };
    const { final } = await run(api);
    expect(final.error).toMatchObject({ step: "generate", code: "failed" });
  });
});
