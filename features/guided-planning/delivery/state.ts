import type { DeliveryErrorCode, DeliveryState, DeliveryStep } from "../types";

const STAGE_LABELS: Record<DeliveryStep, string> = {
  generate: "코드 만드는 중",
  repo: "저장소 만드는 중",
  push: "올리는 중",
  project: "배포 중",
  database: "데이터베이스 만드는 중",
  deploy: "배포 중",
  verify: "확인 중",
};

export function userFacingStage(step: DeliveryStep): string {
  return STAGE_LABELS[step];
}

function hash4(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h.toString(36).padStart(4, "0").slice(-4);
}

export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && !/^\.+$/.test(name);
}

/** 프로젝트 이름을 소문자와 하이픈으로 바꿔 저장소 이름으로 제안한다. 영문이 없으면 이름에서 만든 기본 이름을 쓴다. */
export function proposeRepoName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (slug.length >= 3) return slug;
  return `my-service-${hash4(projectName)}`;
}

export function createDelivery(projectName: string): DeliveryState {
  return {
    repoName: proposeRepoName(projectName),
    confirmed: false,
    running: null,
    done: [],
    repoUrl: null,
    repoId: null,
    owner: null,
    projectId: null,
    needsDatabase: false,
    databaseId: null,
    deployUrl: null,
    deploymentId: null,
    verified: false,
    fixAttempts: 0,
    error: null,
    interrupted: false,
    files: null,
  };
}

export function beginRun(d: DeliveryState, repoName: string): DeliveryState {
  return { ...d, repoName, confirmed: true, error: null, interrupted: false };
}

export function stepStarted(d: DeliveryState, step: DeliveryStep): DeliveryState {
  return { ...d, running: step, error: null, interrupted: false };
}

export function stepDone(d: DeliveryState, step: DeliveryStep, patch: Partial<DeliveryState>): DeliveryState {
  return { ...d, ...patch, running: null, done: d.done.includes(step) ? d.done : [...d.done, step] };
}

export function failRun(d: DeliveryState, step: DeliveryStep, code: DeliveryErrorCode, message: string): DeliveryState {
  return { ...d, running: null, error: { step, code, message } };
}

export function finishRun(d: DeliveryState): DeliveryState {
  return { ...d, running: null, verified: Boolean(d.deployUrl) && d.done.includes("verify") };
}

/** 새로고침으로 끊긴 진행은 이어지지 않으므로, 어느 단계에서 중단됐는지 남기고 멈춘 상태로 바꾼다. */
export function interruptIfRunning(d: DeliveryState): DeliveryState {
  if (!d.running) return d;
  return {
    ...d,
    running: null,
    interrupted: true,
    error: { step: d.running, code: "failed", message: "화면을 닫거나 새로고침해서 진행이 중단됐어요. 다시 시작할 수 있어요." },
  };
}
