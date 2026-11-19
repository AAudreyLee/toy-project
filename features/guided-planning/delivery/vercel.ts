import { DeliveryError } from "./errors";

const API = "https://api.vercel.com";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

type VercelBody = { error?: { code?: string; message?: string; invalidToken?: boolean; missingToken?: boolean } };

async function readError(res: Response): Promise<{ code: string; message: string; invalid: boolean }> {
  const d = ((await res.json().catch(() => ({}))) as VercelBody).error ?? {};
  return { code: d.code ?? "", message: d.message ?? "", invalid: Boolean(d.invalidToken || d.missingToken) };
}

export async function verifyVercelToken(token: string, f: typeof fetch = fetch): Promise<{ name: string | null }> {
  const user = await f(`${API}/v2/user`, { headers: headers(token) });
  if (user.ok) {
    const d = (await user.json()) as { user?: { username?: string } };
    return { name: d.user?.username ?? null };
  }
  const first = await readError(user);
  if (first.invalid) throw new DeliveryError("vercel-auth", "Vercel 토큰이 거부되었어요. 토큰을 다시 확인해 주세요.");
  // 팀 범위 토큰은 사용자 조회가 막히므로 프로젝트 목록으로 확인한다.
  const projects = await f(`${API}/v9/projects?limit=1`, { headers: headers(token) });
  if (projects.ok) return { name: null };
  throw new DeliveryError(
    "vercel-auth",
    "Vercel 토큰으로 프로젝트를 읽을 수 없어요. 계정 전체나 팀 전체 범위로 만든 토큰인지 확인해 주세요.",
  );
}

export async function createProject(
  token: string,
  name: string,
  repoFullName: string,
  f: typeof fetch = fetch,
): Promise<{ id: string; name: string }> {
  const res = await f(`${API}/v11/projects`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ name, framework: "nextjs", gitRepository: { type: "github", repo: repoFullName } }),
  });
  if (res.ok) {
    const d = (await res.json()) as { id: string; name: string };
    return { id: d.id, name: d.name };
  }
  const e = await readError(res);
  if (res.status === 403 || res.status === 401 || e.invalid) {
    throw new DeliveryError(
      "vercel-auth",
      "Vercel 토큰으로 새 프로젝트를 만들 수 없어요. 특정 프로젝트로 한정하지 말고 계정 전체나 팀 전체 범위로 만든 토큰을 써 주세요.",
    );
  }
  if (/repo|git|github/i.test(`${e.code} ${e.message}`)) {
    throw new DeliveryError(
      "vercel-git",
      "Vercel이 새로 만든 저장소를 볼 수 없어요. GitHub에서 Vercel 앱을 설치하고 이 저장소 접근을 허용한 뒤 다시 시도해 주세요.",
    );
  }
  if (res.status === 409) {
    throw new DeliveryError("failed", "같은 이름의 Vercel 프로젝트가 이미 있어요. 저장소 이름을 바꿔 다시 시도해 주세요.");
  }
  throw new DeliveryError("failed", `Vercel 프로젝트를 만들지 못했어요 (${res.status}).`);
}

export async function createDeployment(
  token: string,
  o: { projectName: string; repoId: number },
  f: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  const res = await f(`${API}/v13/deployments`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      name: o.projectName,
      project: o.projectName,
      target: "production",
      gitSource: { type: "github", repoId: o.repoId, ref: "main" },
    }),
  });
  if (!res.ok) {
    const e = await readError(res);
    if (res.status === 401 || res.status === 403 || e.invalid) {
      throw new DeliveryError("vercel-auth", "Vercel 토큰으로 배포할 수 없어요. 다시 연결해 주세요.");
    }
    if (/repo|git|github/i.test(`${e.code} ${e.message}`)) {
      throw new DeliveryError("vercel-git", "Vercel이 저장소를 볼 수 없어요. GitHub에서 Vercel 앱의 저장소 접근을 허용한 뒤 다시 시도해 주세요.");
    }
    throw new DeliveryError("failed", `배포를 시작하지 못했어요 (${res.status}).`);
  }
  const d = (await res.json()) as { id: string; url: string };
  return { id: d.id, url: `https://${d.url}` };
}

export async function getDeployment(
  token: string,
  id: string,
  f: typeof fetch = fetch,
): Promise<{ state: "ready" | "pending" | "error"; url: string }> {
  const res = await f(`${API}/v13/deployments/${id}`, { headers: headers(token) });
  if (!res.ok) throw new DeliveryError("failed", `배포 상태를 읽지 못했어요 (${res.status}).`);
  const d = (await res.json()) as { readyState: string; url: string; alias?: string[] };
  const state = d.readyState === "READY" ? "ready" : d.readyState === "ERROR" || d.readyState === "CANCELED" ? "error" : "pending";
  // 배포마다 생기는 고유 주소는 Vercel 인증으로 보호될 수 있어서, 프로젝트 주소(별칭)가 있으면 그것을 쓴다.
  const alias = d.alias?.find((a) => a.endsWith(".vercel.app"));
  return { state, url: `https://${alias ?? d.url}` };
}

export async function getBuildLog(token: string, id: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${API}/v3/deployments/${id}/events?limit=-1`, { headers: headers(token) });
  if (!res.ok) return "";
  const events = (await res.json()) as { text?: string; payload?: { text?: string } }[];
  const lines = events.map((e) => e.text ?? e.payload?.text ?? "").filter(Boolean);
  return lines.slice(-120).join("\n").slice(-4000);
}
