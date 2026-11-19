import { createDelivery, proposeRepoName } from "./delivery/state";
import { DIRECTION_LABELS, SPEC_LABELS } from "./documents";
import type { AgentReply, Progress, Stage } from "./types";

export type StepStatus = "done" | "current" | "pending" | "review" | "locked";
export type StepView = {
  n: number;
  label: string;
  status: StepStatus;
  isCurrent: boolean;
  clickable: boolean;
};

export function createProgress(): Progress {
  return {
    view: "find",
    projectName: "새 프로젝트",
    idea: null,
    findDone: false,
    direction: {
      messages: [],
      doc: { oneLine: "", usersSituation: "", problemAlternatives: "", promisedChange: "", coreLoop: "" },
      done: false,
    },
    spec: { messages: [], doc: { result: "", scope: [], verification: [], notNow: "" }, done: false },
    review: { 2: false, 3: false, 4: false },
    delivery: createDelivery("새 프로젝트"),
    changeNote: "",
    finished: false,
    fresh: [],
  };
}

function hasDelivery(p: Progress): boolean {
  return Boolean(p.delivery.repoUrl);
}
const STEP_LABELS = ["만들 것 찾기", "서비스 방향", "먼저 만들 결과", "구현", "배포"];
const MAX_NAME = 24;

function projectNameFor(idea: string, title?: string): string {
  const name = (title ?? idea).trim();
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

function started(stage: { messages: unknown[]; done: boolean }): boolean {
  return stage.done || stage.messages.length > 0;
}

export function chooseIdea(p: Progress, idea: string, title?: string): Progress {
  const text = idea.trim();
  const changed = p.idea !== null && p.idea !== text;
  const review2 = p.review[2] || (changed && started(p.direction));
  const review3 = p.review[3] || (changed && started(p.spec));
  return {
    ...p,
    view: "direction",
    idea: text,
    projectName: projectNameFor(text, title),
    findDone: true,
    review: { 2: review2, 3: review3, 4: p.review[4] || (changed && hasDelivery(p)) },
    delivery: p.delivery.confirmed ? p.delivery : { ...p.delivery, repoName: proposeRepoName(projectNameFor(text, title)) },
    changeNote: changed ? `아이디어가 '${p.idea}'에서 '${text}'(으)로 바뀌었어요.` : p.changeNote,
    finished: false,
    fresh: [],
  };
}

export function addUserMessage(p: Progress, stage: Stage, text: string): Progress {
  const t = text.trim();
  if (!t) return p;
  const state = p[stage];
  return { ...p, [stage]: { ...state, messages: [...state.messages, { role: "user", text: t }] }, fresh: [] };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function applyAgentReply<S extends Stage>(p: Progress, stage: S, reply: AgentReply<S>): Progress {
  const state = p[stage];
  const labels: Record<string, string> = stage === "direction" ? DIRECTION_LABELS : SPEC_LABELS;
  const before = state.doc as Record<string, unknown>;
  const after: Record<string, unknown> = { ...before };
  const changedKeys: string[] = [];
  for (const [key, value] of Object.entries(reply.doc as Record<string, unknown>)) {
    if (!(key in before) || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (!same(before[key], value)) {
      after[key] = value;
      changedKeys.push(key);
    }
  }
  const next: Progress = {
    ...p,
    [stage]: { ...state, doc: after, messages: [...state.messages, { role: "agent", text: reply.message }] },
    fresh: changedKeys,
  };
  if (stage === "direction" && changedKeys.length && p.direction.done && started(p.spec)) {
    const lines = changedKeys.map((k) => {
      const old = String(before[k] ?? "").trim();
      return `${labels[k]}: ${old ? `${old} → ` : ""}${String(after[k])}`;
    });
    next.review = { ...p.review, 3: true };
    next.changeNote = `서비스 방향이 바뀌었어요.\n${lines.join("\n")}`;
  }
  if (changedKeys.length && hasDelivery(p)) next.review = { ...(next.review ?? p.review), 4: true };
  return next;
}

export function finishDirection(p: Progress): Progress {
  return { ...p, direction: { ...p.direction, done: true }, view: "spec", finished: false, fresh: [] };
}

export function finishSpec(p: Progress): Progress {
  return { ...p, spec: { ...p.spec, done: true }, review: { ...p.review, 3: false }, finished: true, fresh: [] };
}

export function openStep(p: Progress, n: number): Progress {
  const view = n === 1 ? "find" : n === 2 ? "direction" : n === 3 ? "spec" : (n === 4 || n === 5) && p.spec.done ? "delivery" : null;
  if (!view) return p;
  return { ...p, view, finished: false, fresh: [] };
}

export function resolveReview(p: Progress, step: 2 | 3 | 4): Progress {
  const review = { ...p.review, [step]: false };
  return { ...p, review, changeNote: review[2] || review[3] || review[4] ? p.changeNote : "" };
}

export function stepViews(p: Progress): StepView[] {
  const done = [p.findDone, p.direction.done, p.spec.done];
  const current: Record<string, number> = { find: 1, direction: 2, spec: 3 };
  return STEP_LABELS.map((label, i) => {
    const n = i + 1;
    if (n > 3) {
      if (!p.spec.done) return { n, label, status: "locked", isCurrent: false, clickable: false };
      const onDelivery = p.view === "delivery";
      const isCurrent = onDelivery && (n === 4 ? !hasDelivery(p) : hasDelivery(p));
      const finished = n === 4 ? hasDelivery(p) : p.delivery.verified;
      const status: StepStatus = p.review[4] ? "review" : finished ? "done" : isCurrent ? "current" : "pending";
      return { n, label, status, isCurrent, clickable: !isCurrent };
    }
    const isCurrent = current[p.view] === n;
    const review = n === 2 ? p.review[2] : n === 3 ? p.review[3] : false;
    const status: StepStatus = review ? "review" : done[i] ? "done" : isCurrent ? "current" : "pending";
    return { n, label, status, isCurrent, clickable: (status === "done" || status === "review") && !isCurrent };
  });
}

export function nextAction(p: Progress): string {
  if (p.view === "find") return "만들고 싶은 것을 한 줄로 적거나, 재료를 골라 아이디어를 받아 보세요.";
  if (p.view === "delivery") {
    if (p.delivery.verified) return "배포 주소를 열어 첫 Spec의 확인 방법대로 직접 확인해 보세요.";
    if (p.delivery.running || hasDelivery(p)) return "agent가 저장소에 올리고 배포하고 있어요. 끝나면 배포 주소가 보여요.";
    return "두 계정을 연결하고 저장소 이름을 확인한 뒤 '만들고 올리기'를 눌러 주세요.";
  }
  if (p.view === "direction") return "agent의 질문에 답하면 오른쪽 서비스 방향 문서가 채워져요.";
  return p.finished
    ? "두 문서를 내려받아 두세요."
    : "처음 완성할 결과 하나를 agent와 정해요. 한 번에 만들고 직접 써 볼 수 있는 크기예요.";
}

export function showEditNotice(p: Progress): boolean {
  return p.view === "direction" && p.direction.done && p.spec.done;
}
