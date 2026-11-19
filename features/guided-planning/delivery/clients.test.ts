import { describe, expect, it, vi } from "vitest";
import { DeliveryError } from "./errors";
import { buildAuthorizeUrl, createRepo, exchangeCode, getGithubUser, putFiles } from "./github";
import { createDeployment, createProject, getBuildLog, getDeployment, verifyVercelToken } from "./vercel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sequence(...responses: Response[]) {
  let i = 0;
  return vi.fn(async () => responses[Math.min(i++, responses.length - 1)].clone());
}
function lastRequest(f: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = f.mock.calls[n] as unknown as [string, RequestInit];
  return { url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
}

describe("GitHub 연결", () => {
  it("승인 주소에는 클라이언트 ID, 돌아올 주소, 상태값, 저장소 생성 권한이 담긴다", () => {
    const url = new URL(buildAuthorizeUrl("cid", "http://localhost:3000/api/github/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/github/callback");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toContain("repo");
  });

  it("승인 코드를 접근 권한으로 바꾼다", async () => {
    const f = sequence(json({ access_token: "gho_abc", token_type: "bearer" }));
    await expect(exchangeCode({ clientId: "cid", clientSecret: "sec", code: "c", redirectUri: "http://x/cb" }, f)).resolves.toBe("gho_abc");
    const { body, url } = lastRequest(f);
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(body).toMatchObject({ client_id: "cid", client_secret: "sec", code: "c" });
  });

  it("승인 코드가 잘못되면 연결 오류로 알린다", async () => {
    const f = sequence(json({ error: "bad_verification_code" }));
    await expect(exchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "u" }, f)).rejects.toMatchObject({ code: "github-auth" });
  });

  it("접근 권한으로 사용자 이름을 읽고, 거부되면 연결 오류로 알린다", async () => {
    await expect(getGithubUser("t", sequence(json({ login: "octo", id: 1 })))).resolves.toEqual({ login: "octo" });
    await expect(getGithubUser("t", sequence(json({ message: "Bad credentials" }, 401)))).rejects.toMatchObject({ code: "github-auth" });
  });

  it("새 비공개 저장소를 만들고 주소와 번호를 돌려준다", async () => {
    const f = sequence(json({ id: 77, name: "my-repo", full_name: "octo/my-repo", html_url: "https://github.com/octo/my-repo", owner: { login: "octo" } }, 201));
    const repo = await createRepo("t", "my-repo", f);
    expect(repo).toEqual({ id: 77, owner: "octo", name: "my-repo", url: "https://github.com/octo/my-repo" });
    const { body, url, headers } = lastRequest(f);
    expect(url).toBe("https://api.github.com/user/repos");
    expect(body).toMatchObject({ name: "my-repo", private: true });
    expect(headers.Authorization).toBe("Bearer t");
  });

  it("같은 이름의 저장소가 있으면 덮어쓰지 않고 이름을 바꾸라고 알린다", async () => {
    const f = sequence(json({ message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] }, 422));
    await expect(createRepo("t", "dup", f)).rejects.toMatchObject({ code: "name-taken" });
  });

  it("파일을 하나씩 올리고, 경로와 내용(base64)과 메시지가 담긴다", async () => {
    const f = sequence(json({ content: {} }, 201));
    await putFiles("t", "octo", "my-repo", { "app/page.tsx": "hello", "a.txt": "b" }, f);
    expect(f).toHaveBeenCalledTimes(2);
    const first = lastRequest(f, 0);
    expect(first.url).toBe("https://api.github.com/repos/octo/my-repo/contents/app/page.tsx");
    expect(first.init.method).toBe("PUT");
    expect(Buffer.from(first.body.content, "base64").toString()).toBe("hello");
    expect(first.body.message).toBeTruthy();
  });

  it("이미 있는 파일을 고칠 때는 현재 파일의 sha를 읽어 함께 보낸다", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "PUT" ? json({ content: {} }) : json({ sha: "abc123" })));
    await putFiles("t", "octo", "r", { "app/page.tsx": "new" }, f as unknown as typeof fetch, { update: true });
    const put = f.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body)).sha).toBe("abc123");
  });

  it("파일 올리기가 실패하면 실패한 파일을 알린다", async () => {
    await expect(putFiles("t", "o", "r", { "a.txt": "x" }, sequence(json({ message: "nope" }, 500)))).rejects.toThrow(/a\.txt/);
  });
});

describe("Vercel 연결", () => {
  it("토큰이 프로젝트 목록을 읽을 수 있으면 연결됨으로 보고 가능하면 사용자 이름도 알려 준다", async () => {
    const withName = sequence(json({ user: { username: "kim" } }));
    await expect(verifyVercelToken("vcp_x", withName)).resolves.toEqual({ name: "kim" });
    const teamScoped = vi.fn(async (url: string) => (String(url).includes("/v2/user") ? json({ error: { code: "not_found" } }, 404) : json({ projects: [] })));
    await expect(verifyVercelToken("vcp_x", teamScoped as unknown as typeof fetch)).resolves.toEqual({ name: null });
  });

  it("토큰이 거부되면 토큰 오류로 알린다", async () => {
    const f = vi.fn(async () => json({ error: { code: "forbidden", invalidToken: true } }, 403));
    await expect(verifyVercelToken("bad", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "vercel-auth" });
  });

  it("저장소를 연결한 새 프로젝트를 만든다", async () => {
    const f = sequence(json({ id: "prj_1", name: "my-repo" }));
    await expect(createProject("t", "my-repo", "octo/my-repo", f)).resolves.toEqual({ id: "prj_1", name: "my-repo" });
    const { body, url } = lastRequest(f);
    expect(url).toContain("https://api.vercel.com/v11/projects");
    expect(body).toMatchObject({ name: "my-repo", framework: "nextjs", gitRepository: { type: "github", repo: "octo/my-repo" } });
  });

  it("프로젝트 생성 권한이 없으면 토큰 오류, 저장소를 볼 수 없으면 Vercel GitHub 앱 안내 오류로 구분한다", async () => {
    const forbidden = sequence(json({ error: { code: "forbidden", message: "You don't have permission to create the project." } }, 403));
    await expect(createProject("t", "n", "o/n", forbidden)).rejects.toMatchObject({ code: "vercel-auth" });
    const noRepo = sequence(json({ error: { code: "repo_not_found", message: "The repository could not be found" } }, 400));
    await expect(createProject("t", "n", "o/n", noRepo)).rejects.toMatchObject({ code: "vercel-git" });
  });

  it("첫 배포를 요청하고 배포 번호와 주소를 돌려준다", async () => {
    const f = sequence(json({ id: "dpl_1", url: "my-repo-abc.vercel.app", readyState: "QUEUED" }));
    await expect(createDeployment("t", { projectName: "my-repo", repoId: 77 }, f)).resolves.toEqual({ id: "dpl_1", url: "https://my-repo-abc.vercel.app" });
    const { body, url } = lastRequest(f);
    expect(url).toContain("https://api.vercel.com/v13/deployments");
    expect(body).toMatchObject({ name: "my-repo", project: "my-repo", gitSource: { type: "github", repoId: 77, ref: "main" } });
  });

  it("배포 상태를 읽어 준비됨, 진행 중, 실패로 나눈다", async () => {
    await expect(getDeployment("t", "d", sequence(json({ readyState: "READY", url: "a.vercel.app" })))).resolves.toEqual({ state: "ready", url: "https://a.vercel.app" });
    await expect(getDeployment("t", "d", sequence(json({ readyState: "BUILDING", url: "a.vercel.app" })))).resolves.toMatchObject({ state: "pending" });
    await expect(getDeployment("t", "d", sequence(json({ readyState: "ERROR", url: "a.vercel.app" })))).resolves.toMatchObject({ state: "error" });
  });

  it("배포 별칭(프로젝트 주소)이 있으면 보호되지 않은 그 주소를 우선 돌려준다", async () => {
    const f = sequence(json({ readyState: "READY", url: "my-repo-abc.vercel.app", alias: ["my-repo.vercel.app", "other.example.com"] }));
    await expect(getDeployment("t", "d", f)).resolves.toEqual({ state: "ready", url: "https://my-repo.vercel.app" });
  });

  it("빌드 로그는 글자만 이어 붙여 끝부분만 돌려준다", async () => {
    const events = Array.from({ length: 300 }, (_, i) => ({ type: "stdout", text: `line ${i}` }));
    const log = await getBuildLog("t", "d", sequence(json(events)));
    expect(log).toContain("line 299");
    expect(log).not.toContain("line 0\n");
    expect(log.length).toBeLessThan(6000);
  });
});

describe("오류 종류", () => {
  it("연결 오류는 종류와 사용자에게 보일 문장을 가진다", () => {
    const e = new DeliveryError("github-auth", "GitHub 연결을 확인해 주세요");
    expect(e.code).toBe("github-auth");
    expect(e.message).toContain("GitHub");
  });
});
