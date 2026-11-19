import { interruptIfRunning } from "./delivery/state";
import { createProgress } from "./progress";
import type { Connection, Progress } from "./types";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PROGRESS_KEY = "guided-planning:progress";
const CONNECTION_KEY = "guided-planning:connection";
const VERCEL_KEY = "guided-planning:vercel";

export function saveProgress(store: Store, p: Progress): void {
  store.setItem(PROGRESS_KEY, JSON.stringify(p));
}

function looksLikeProgress(v: unknown): v is Progress {
  const p = v as Progress | null;
  return (
    !!p &&
    ["find", "direction", "spec"].includes(p.view) &&
    typeof p.projectName === "string" &&
    Array.isArray(p.direction?.messages) &&
    typeof p.direction?.doc === "object" &&
    Array.isArray(p.spec?.messages) &&
    Array.isArray(p.spec?.doc?.scope) &&
    typeof p.review === "object" &&
    Array.isArray(p.fresh)
  );
}

export function loadProgress(store: Store): Progress {
  try {
    const parsed = JSON.parse(store.getItem(PROGRESS_KEY) ?? "null");
    if (!looksLikeProgress(parsed)) return createProgress();
    // 구현·배포 기능이 생기기 전에 저장된 진행 상황은 4·5단계 값을 처음 값으로 채워 읽는다.
    const fresh = createProgress();
    return {
      ...parsed,
      review: { ...fresh.review, ...parsed.review },
      delivery: interruptIfRunning({ ...fresh.delivery, ...(parsed.delivery ?? {}) }),
    };
  } catch {
    return createProgress();
  }
}

export function saveConnection(store: Store, c: Connection): void {
  store.setItem(CONNECTION_KEY, JSON.stringify(c));
}

export function loadConnection(store: Store): Connection | null {
  try {
    const c = JSON.parse(store.getItem(CONNECTION_KEY) ?? "null");
    return c && typeof c.apiKey === "string" && typeof c.endpoint === "string" && typeof c.deployment === "string"
      ? { apiKey: c.apiKey, endpoint: c.endpoint, deployment: c.deployment }
      : null;
  } catch {
    return null;
  }
}

export function clearConnection(store: Store): void {
  store.removeItem(CONNECTION_KEY);
}

export type VercelConnection = { token: string; name: string | null };

export function saveVercelToken(store: Store, v: VercelConnection): void {
  store.setItem(VERCEL_KEY, JSON.stringify(v));
}

export function loadVercelToken(store: Store): VercelConnection | null {
  try {
    const v = JSON.parse(store.getItem(VERCEL_KEY) ?? "null");
    return v && typeof v.token === "string" && v.token ? { token: v.token, name: typeof v.name === "string" ? v.name : null } : null;
  } catch {
    return null;
  }
}

export function clearVercelToken(store: Store): void {
  store.removeItem(VERCEL_KEY);
}
