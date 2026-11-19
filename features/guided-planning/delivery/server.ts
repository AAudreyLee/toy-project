import type { Connection, DirectionDoc, SpecDoc } from "../types";
import { DeliveryError } from "./errors";
import { generateFiles, fixFiles, judgeSupport } from "./generate";
import { commitFiles, createRepo } from "./github";
import { isValidRepoName } from "./state";
import { createDeployment, createProject, getBuildLog, getDeployment } from "./vercel";

export type DeliveryResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; code: string; message: string };

type Secrets = { githubToken?: string };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asConnection(v: unknown): Connection {
  const c = (v ?? {}) as Record<string, unknown>;
  return { apiKey: str(c.apiKey), endpoint: str(c.endpoint), deployment: str(c.deployment) };
}

function asSpec(v: unknown): SpecDoc {
  const s = (v ?? {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  return { result: str(s.result), scope: list(s.scope), verification: list(s.verification), notNow: str(s.notNow) };
}

function asDirection(v: unknown): DirectionDoc {
  const d = (v ?? {}) as Record<string, unknown>;
  return {
    oneLine: str(d.oneLine),
    usersSituation: str(d.usersSituation),
    problemAlternatives: str(d.problemAlternatives),
    promisedChange: str(d.promisedChange),
    coreLoop: str(d.coreLoop),
  };
}

function asFiles(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, c]) => typeof c === "string")) as Record<string, string>;
}

function needGithub(s: Secrets): string {
  if (!s.githubToken) throw new DeliveryError("github-auth", "GitHub 연결이 필요해요. 먼저 GitHub로 연결해 주세요.");
  return s.githubToken;
}

function needVercel(b: Record<string, unknown>): string {
  const t = str(b.vercelToken);
  if (!t) throw new DeliveryError("vercel-auth", "Vercel 연결이 필요해요. 먼저 Vercel 토큰을 연결해 주세요.");
  return t;
}

// 배포 주소 확인은 서비스 서버가 대신 요청하므로, https인 vercel.app 주소만 허용한다.
function checkableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeliveryError("failed", "확인할 배포 주소가 올바르지 않아요.");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app") || url.username || url.password) {
    throw new DeliveryError("failed", "확인할 수 없는 주소예요. Vercel 배포 주소만 확인해요.");
  }
  return url;
}

async function run(body: unknown, secrets: Secrets, f: typeof fetch): Promise<DeliveryResponse> {
  const b = (body ?? {}) as Record<string, unknown>;

  switch (b.kind) {
    case "plan": {
      const r = await judgeSupport(asConnection(b.connection), asSpec(b.spec), asDirection(b.direction), f);
      return { ok: true, ...r };
    }
    case "generate": {
      const files = await generateFiles(asConnection(b.connection), { spec: asSpec(b.spec), direction: asDirection(b.direction), repoName: str(b.repoName) }, f);
      return { ok: true, files };
    }
    case "fix": {
      const files = await fixFiles(asConnection(b.connection), { files: asFiles(b.files), buildLog: str(b.buildLog) }, f);
      return { ok: true, files };
    }
    case "repo": {
      const token = needGithub(secrets);
      const name = str(b.repoName);
      if (!isValidRepoName(name)) throw new DeliveryError("name-taken", "저장소 이름은 영문, 숫자, 하이픈, 밑줄, 점만 쓸 수 있어요.");
      return { ok: true, repo: await createRepo(token, name, f) };
    }
    case "push": {
      const token = needGithub(secrets);
      await commitFiles(token, str(b.owner), str(b.repo), asFiles(b.files), b.update === true ? "빌드 오류 수정" : "첫 코드 추가", f);
      return { ok: true };
    }
    case "project": {
      const token = needVercel(b);
      const p = await createProject(token, str(b.repo), `${str(b.owner)}/${str(b.repo)}`, f);
      return { ok: true, projectId: p.id, projectName: p.name };
    }
    case "deploy": {
      const token = needVercel(b);
      const d = await createDeployment(token, { projectName: str(b.projectName), repoId: Number(b.repoId) }, f);
      return { ok: true, deploymentId: d.id, url: d.url };
    }
    case "poll": {
      const token = needVercel(b);
      const id = str(b.deploymentId);
      const d = await getDeployment(token, id, f);
      if (d.state === "error") return { ok: true, state: d.state, url: d.url, reason: d.reason ?? "", buildLog: await getBuildLog(token, id, f) };
      return { ok: true, state: d.state, url: d.url };
    }
    case "verify": {
      const url = checkableUrl(str(b.url));
      const res = await f(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!res) throw new DeliveryError("failed", "배포 주소에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      if (res.status === 401 || res.status === 403) {
        throw new DeliveryError("failed", "배포는 됐지만 Vercel 인증으로 보호되어 있어요. Vercel 프로젝트의 Deployment Protection 설정을 확인해 주세요.");
      }
      if (!res.ok) throw new DeliveryError("failed", `배포 주소가 오류 응답을 줬어요 (${res.status}).`);
      return { ok: true };
    }
    default:
      throw new DeliveryError("failed", "알 수 없는 요청이에요.");
  }
}

export async function handleDeliveryRequest(body: unknown, secrets: Secrets, fetchImpl: typeof fetch = fetch): Promise<DeliveryResponse> {
  try {
    return await run(body, secrets, fetchImpl);
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "failed", message: "알 수 없는 오류가 났어요." };
  }
}
