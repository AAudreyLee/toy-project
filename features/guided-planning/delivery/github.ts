import { DeliveryError } from "./errors";

const API = "https://api.github.com";

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "guided-planning",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  // 비공개 저장소를 만들고 코드를 올리는 데 필요한 권한만 요청한다.
  url.searchParams.set("scope", "repo");
  return url.toString();
}

export async function exchangeCode(
  o: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  f: typeof fetch = fetch,
): Promise<string> {
  const res = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "guided-planning" },
    body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!data.access_token) throw new DeliveryError("github-auth", "GitHub 승인을 확인하지 못했어요. 다시 연결해 주세요.");
  return data.access_token;
}

export async function getGithubUser(token: string, f: typeof fetch = fetch): Promise<{ login: string }> {
  const res = await f(`${API}/user`, { headers: apiHeaders(token) });
  if (res.status === 401 || res.status === 403) {
    throw new DeliveryError("github-auth", "GitHub 연결이 만료되었거나 거부되었어요. 다시 연결해 주세요.");
  }
  if (!res.ok) throw new DeliveryError("failed", `GitHub에서 사용자 정보를 읽지 못했어요 (${res.status}).`);
  const data = (await res.json()) as { login: string };
  return { login: data.login };
}

export async function createRepo(
  token: string,
  name: string,
  f: typeof fetch = fetch,
): Promise<{ id: number; owner: string; name: string; url: string }> {
  const res = await f(`${API}/user/repos`, {
    method: "POST",
    headers: apiHeaders(token),
    body: JSON.stringify({ name, private: true, description: "agent가 첫 Spec으로 만든 시스템", auto_init: true }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new DeliveryError("github-auth", "GitHub에서 저장소를 만들 권한이 없어요. 다시 연결해 주세요.");
  }
  if (res.status === 422) throw new DeliveryError("name-taken", "같은 이름의 저장소가 이미 있어요. 다른 이름으로 바꿔 주세요.");
  if (!res.ok) throw new DeliveryError("failed", `저장소를 만들지 못했어요 (${res.status}).`);
  const d = (await res.json()) as { id: number; name: string; html_url: string; owner: { login: string } };
  return { id: d.id, owner: d.owner.login, name: d.name, url: d.html_url };
}

/** 파일 전체를 한 번의 커밋으로 main에 올린다. 파일마다 커밋을 만들면 커밋마다 Vercel 배포가 생기므로 쓰지 않는다. */
export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  files: Record<string, string>,
  message: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const base = `${API}/repos/${owner}/${repo}`;
  const step = async (name: string, url: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await f(url, { ...init, headers: apiHeaders(token) });
    if (res.status === 401 || res.status === 403) {
      throw new DeliveryError("github-auth", "GitHub에 코드를 올릴 권한이 없어요. 다시 연결해 주세요.");
    }
    if (!res.ok) throw new DeliveryError("failed", `${name}을(를) 올리지 못했어요 (${res.status}).`);
    return (await res.json()) as Record<string, unknown>;
  };
  const head = ((await step("기준 커밋 확인", `${base}/git/ref/heads/main`)).object as { sha: string }).sha;
  const baseTree = ((await step("기준 파일 목록 확인", `${base}/git/commits/${head}`)).tree as { sha: string }).sha;
  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await step(`${path} 파일`, `${base}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" }),
    });
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha as string });
  }
  const tree = await step("파일 목록", `${base}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
  const commit = await step("커밋", `${base}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) });
  await step("브랜치 갱신", `${base}/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
}
