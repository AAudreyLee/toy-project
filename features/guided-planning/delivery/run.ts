import type { Connection, DeliveryErrorCode, DeliveryState, DeliveryStep, DirectionDoc, SpecDoc } from "../types";
import { beginRun, failRun, finishRun, stepDone, stepStarted } from "./state";

type Reply = Record<string, unknown> & ({ ok: true } | { ok: false; code: string; message: string });
export type DeliveryApi = (req: Record<string, unknown> & { kind: string }) => Promise<Reply>;

export type RunInput = {
  api: DeliveryApi;
  delivery: DeliveryState;
  spec: SpecDoc;
  direction: DirectionDoc;
  connection: Connection;
  vercelToken: string;
  repoName: string;
  onChange: (d: DeliveryState) => void;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
};

const MAX_FIXES = 2;
const POLL_MS = 3000;
const DEFAULT_MAX_POLLS = 100;
const CODES: DeliveryErrorCode[] = ["github-auth", "vercel-auth", "vercel-git", "name-taken", "build", "unsupported", "failed"];

/** 코드 만들기부터 배포 확인까지 이어서 실행한다. 이미 끝낸 단계는 건너뛰므로 실패한 단계부터 다시 시도할 수 있다. */
export async function runDelivery(input: RunInput): Promise<DeliveryState> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPolls = input.maxPolls ?? DEFAULT_MAX_POLLS;
  // 빌드 실패로 멈춘 뒤 다시 시도하면 자동 수정 기회도 처음부터 다시 쓴다.
  let d = beginRun(input.delivery.error?.code === "build" ? { ...input.delivery, fixAttempts: 0 } : input.delivery, input.repoName);
  const emit = (next: DeliveryState) => {
    d = next;
    input.onChange(next);
  };
  emit(d);

  const call = async (req: Record<string, unknown> & { kind: string }): Promise<Reply> => {
    try {
      return await input.api(req);
    } catch {
      return { ok: false, code: "failed", message: "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." };
    }
  };
  const fail = (step: DeliveryStep, r: Reply): DeliveryState => {
    const code = (CODES as string[]).includes(String(r.code)) ? (r.code as DeliveryErrorCode) : "failed";
    emit(failRun(d, step, code, String(r.message ?? "알 수 없는 오류가 났어요.")));
    return d;
  };
  const failWith = (step: DeliveryStep, code: DeliveryErrorCode, message: string): DeliveryState => {
    emit(failRun(d, step, code, message));
    return d;
  };
  const todo = (step: DeliveryStep) => !d.done.includes(step);

  if (todo("generate")) {
    emit(stepStarted(d, "generate"));
    const r = await call({ kind: "generate", connection: input.connection, spec: input.spec, direction: input.direction, repoName: d.repoName });
    if (!r.ok) return fail("generate", r);
    emit(stepDone(d, "generate", { files: r.files as Record<string, string> }));
  }

  if (todo("repo")) {
    emit(stepStarted(d, "repo"));
    const r = await call({ kind: "repo", repoName: d.repoName });
    if (!r.ok) return fail("repo", r);
    const repo = r.repo as { id: number; owner: string; name: string; url: string };
    emit(stepDone(d, "repo", { repoId: repo.id, owner: repo.owner, repoUrl: repo.url, repoName: repo.name }));
  }

  if (todo("push")) {
    emit(stepStarted(d, "push"));
    const r = await call({ kind: "push", owner: d.owner, repo: d.repoName, files: d.files });
    if (!r.ok) return fail("push", r);
    emit(stepDone(d, "push", {}));
  }

  if (todo("project")) {
    emit(stepStarted(d, "project"));
    const r = await call({ kind: "project", vercelToken: input.vercelToken, owner: d.owner, repo: d.repoName });
    if (!r.ok) return fail("project", r);
    emit(stepDone(d, "project", { projectId: String(r.projectId) }));
  }

  if (todo("deploy")) {
    let attempt = d.fixAttempts;
    for (;;) {
      emit(stepStarted(d, "deploy"));
      const dep = await call({ kind: "deploy", vercelToken: input.vercelToken, projectName: d.repoName, repoId: d.repoId });
      if (!dep.ok) return fail("deploy", dep);
      const deploymentId = String(dep.deploymentId);

      let outcome: { state: "ready" | "error"; url: string; log: string; reason: string } | null = null;
      for (let i = 0; i < maxPolls; i++) {
        const p = await call({ kind: "poll", vercelToken: input.vercelToken, deploymentId });
        if (!p.ok) return fail("deploy", p);
        if (p.state === "ready" || p.state === "error") {
          outcome = { state: p.state, url: String(p.url), log: String(p.buildLog ?? ""), reason: String(p.reason ?? "") };
          break;
        }
        await sleep(POLL_MS);
      }
      if (!outcome) return failWith("deploy", "failed", "배포가 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요.");

      if (outcome.state === "ready") {
        emit(stepDone(d, "deploy", { deploymentId, deployUrl: outcome.url }));
        break;
      }

      // 취약한 의존성 버전처럼 코드를 고쳐서는 풀 수 없는 거부는 고치려 하지 않고 이유를 그대로 알린다.
      if (/vulnerable/i.test(outcome.reason)) return failWith("deploy", "build", `Vercel이 배포를 거부했어요: ${outcome.reason}`);
      if (attempt >= MAX_FIXES) {
        return failWith("deploy", "build", `배포 빌드가 실패했어요. ${outcome.log.slice(-600) || "빌드 로그를 읽지 못했어요."}`);
      }
      const fixed = await call({ kind: "fix", connection: input.connection, files: d.files, buildLog: outcome.log });
      if (!fixed.ok) return fail("deploy", fixed);
      const files = fixed.files as Record<string, string>;
      const pushed = await call({ kind: "push", owner: d.owner, repo: d.repoName, files, update: true });
      if (!pushed.ok) return fail("deploy", pushed);
      attempt += 1;
      emit({ ...d, files, fixAttempts: attempt });
    }
  }

  if (todo("verify")) {
    emit(stepStarted(d, "verify"));
    const r = await call({ kind: "verify", url: d.deployUrl });
    if (!r.ok) return fail("verify", r);
    emit(stepDone(d, "verify", {}));
  }

  emit(finishRun(d));
  return d;
}
