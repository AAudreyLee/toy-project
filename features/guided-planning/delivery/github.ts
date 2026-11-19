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
    body: JSON.stringify({ name, private: true, description: "agent가 첫 Spec으로 만든 시스템", auto_init: false }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new DeliveryError("github-auth", "GitHub에서 저장소를 만들 권한이 없어요. 다시 연결해 주세요.");
  }
  if (res.status === 422) throw new DeliveryError("name-taken", "같은 이름의 저장소가 이미 있어요. 다른 이름으로 바꿔 주세요.");
  if (!res.ok) throw new DeliveryError("failed", `저장소를 만들지 못했어요 (${res.status}).`);
  const d = (await res.json()) as { id: number; name: string; html_url: string; owner: { login: string } };
  return { id: d.id, owner: d.owner.login, name: d.name, url: d.html_url };
}

export async function putFiles(
  token: string,
  owner: string,
  repo: string,
  files: Record<string, string>,
  f: typeof fetch = fetch,
  opts: { update?: boolean } = {},
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const url = `${API}/repos/${owner}/${repo}/contents/${encoded}`;
    let sha: string | undefined;
    if (opts.update) {
      // 이미 있는 파일을 고칠 때는 현재 파일의 sha가 필요하다. 없으면 새 파일로 올린다.
      const current = await f(url, { headers: apiHeaders(token) });
      if (current.ok) sha = ((await current.json()) as { sha?: string }).sha;
    }
    const res = await f(url, {
      method: "PUT",
      headers: apiHeaders(token),
      body: JSON.stringify({
        message: `${opts.update ? "Update" : "Add"} ${path}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new DeliveryError("github-auth", "GitHub에 파일을 올릴 권한이 없어요. 다시 연결해 주세요.");
    }
    if (!res.ok) throw new DeliveryError("failed", `${path} 파일을 올리지 못했어요 (${res.status}).`);
  }
}
