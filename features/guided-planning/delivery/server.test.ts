import { describe, expect, it, vi } from "vitest";
import { handleDeliveryRequest } from "./server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const connection = { apiKey: "AZ-SECRET", endpoint: "https://r.openai.azure.com", deployment: "d" };
const spec = { result: "r", scope: ["s"], verification: ["v"], notNow: "n" };
const direction = { oneLine: "o", usersSituation: "u", problemAlternatives: "p", promisedChange: "c", coreLoop: "l" };

/** URL별로 응답을 정하는 가짜 fetch. */
function router(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [prefix, h] of Object.entries(routes)) if (String(url).startsWith(prefix)) return h(init);
    return json({ message: `unexpected ${url}` }, 500);
  });
  return { f: f as unknown as typeof fetch, calls };
}
const azureReply = (content: unknown) => json({ choices: [{ message: { content: JSON.stringify(content) } }] });

describe("구현·배포 서버 요청", () => {
  it("알 수 없는 요청 종류는 invalid로 알린다", async () => {
    const res = await handleDeliveryRequest({ kind: "nope" }, { githubToken: "g" }, fetch);
    expect(res).toMatchObject({ ok: false, code: "failed" });
  });

  it("지원 범위 판정을 돌려준다", async () => {
    const { f } = router({ "https://r.openai.azure.com": () => azureReply({ supported: false, reason: "메일 발송은 계정이 필요해요", hint: "화면에 보이는 것으로 줄여요" }) });
    const res = await handleDeliveryRequest({ kind: "plan", connection, spec, direction }, {}, f);
    expect(res).toMatchObject({ ok: true, supported: false, reason: expect.stringContaining("메일"), hint: expect.any(String) });
  });

  it("코드를 만들어 파일 목록으로 돌려준다", async () => {
    const page = '"use client";\nexport default function P() { return <main>x</main>; }\n';
    const { f } = router({ "https://r.openai.azure.com": () => azureReply({ files: { "app/page.tsx": page } }) });
    const res = await handleDeliveryRequest({ kind: "generate", connection, spec, direction, repoName: "r" }, {}, f);
    expect(res).toMatchObject({ ok: true });
    if (res.ok) expect((res.files as Record<string, string>)["app/page.tsx"]).toBe(page);
  });

  it("저장소 만들기는 GitHub 연결이 없으면 연결 오류로 알린다", async () => {
    const res = await handleDeliveryRequest({ kind: "repo", repoName: "r" }, {}, fetch);
    expect(res).toMatchObject({ ok: false, code: "github-auth" });
  });

  it("GitHub 연결로 새 비공개 저장소를 만들어 주소를 돌려준다", async () => {
    const { f, calls } = router({
      "https://api.github.com/user/repos": () => json({ id: 5, name: "r", html_url: "https://github.com/o/r", owner: { login: "o" } }, 201),
    });
    const res = await handleDeliveryRequest({ kind: "repo", repoName: "r" }, { githubToken: "gho_t" }, f);
    expect(res).toEqual({ ok: true, repo: { id: 5, owner: "o", name: "r", url: "https://github.com/o/r" } });
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer gho_t");
  });

  it("잘못된 저장소 이름은 GitHub를 부르지 않고 알린다", async () => {
    const { f, calls } = router({});
    const res = await handleDeliveryRequest({ kind: "repo", repoName: "한글 이름" }, { githubToken: "t" }, f);
    expect(res).toMatchObject({ ok: false, code: "name-taken" });
    expect(calls).toHaveLength(0);
  });

  it("생성한 파일을 저장소에 올린다", async () => {
    const { f, calls } = router({ "https://api.github.com/repos/o/r/contents/": () => json({ content: {} }, 201) });
    const res = await handleDeliveryRequest({ kind: "push", owner: "o", repo: "r", files: { "a.txt": "x" } }, { githubToken: "t" }, f);
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("Vercel 단계는 토큰이 없으면 토큰 오류로 알린다", async () => {
    for (const kind of ["project", "deploy", "poll"]) {
      expect(await handleDeliveryRequest({ kind }, {}, fetch)).toMatchObject({ ok: false, code: "vercel-auth" });
    }
  });

  it("Vercel 프로젝트를 만들고 첫 배포를 요청한다", async () => {
    const { f } = router({
      "https://api.vercel.com/v11/projects": () => json({ id: "prj_1", name: "r" }),
      "https://api.vercel.com/v13/deployments": () => json({ id: "dpl_1", url: "r-abc.vercel.app" }),
    });
    expect(await handleDeliveryRequest({ kind: "project", vercelToken: "vcp", owner: "o", repo: "r" }, {}, f)).toEqual({ ok: true, projectId: "prj_1", projectName: "r" });
    expect(await handleDeliveryRequest({ kind: "deploy", vercelToken: "vcp", projectName: "r", repoId: 5 }, {}, f)).toEqual({ ok: true, deploymentId: "dpl_1", url: "https://r-abc.vercel.app" });
  });

  it("배포 상태를 돌려주고, 실패하면 빌드 로그를 함께 돌려준다", async () => {
    const { f } = router({
      "https://api.vercel.com/v13/deployments/dpl_1": () => json({ readyState: "ERROR", url: "r.vercel.app" }),
      "https://api.vercel.com/v3/deployments/dpl_1/events": () => json([{ text: "Type error: boom" }]),
    });
    const res = await handleDeliveryRequest({ kind: "poll", vercelToken: "vcp", deploymentId: "dpl_1" }, {}, f);
    expect(res).toMatchObject({ ok: true, state: "error", buildLog: expect.stringContaining("boom") });
  });

  it("배포 주소가 정상 응답을 주면 확인되고, 오류 응답이면 실패로 알린다", async () => {
    const good = router({ "https://r.vercel.app": () => new Response("<html>ok</html>", { status: 200 }) });
    expect(await handleDeliveryRequest({ kind: "verify", url: "https://r.vercel.app" }, {}, good.f)).toEqual({ ok: true });
    const bad = router({ "https://r.vercel.app": () => new Response("x", { status: 401 }) });
    expect(await handleDeliveryRequest({ kind: "verify", url: "https://r.vercel.app" }, {}, bad.f)).toMatchObject({ ok: false });
  });

  it("확인할 주소는 https인 vercel.app 주소만 허용한다", async () => {
    const { f, calls } = router({});
    for (const url of ["http://r.vercel.app", "https://evil.example.com", "https://169.254.169.254/", "file:///etc/passwd", ""]) {
      expect(await handleDeliveryRequest({ kind: "verify", url }, {}, f)).toMatchObject({ ok: false });
    }
    expect(calls).toHaveLength(0);
  });

  it("응답에 키와 토큰을 되돌려주거나 로그로 남기지 않는다", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { f } = router({ "https://r.openai.azure.com": () => json({}, 401), "https://api.github.com": () => json({}, 401) });
    const results = [
      await handleDeliveryRequest({ kind: "plan", connection, spec, direction }, {}, f),
      await handleDeliveryRequest({ kind: "repo", repoName: "r" }, { githubToken: "GH-SECRET" }, f),
    ];
    expect(JSON.stringify(results)).not.toMatch(/AZ-SECRET|GH-SECRET/);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toMatch(/AZ-SECRET|GH-SECRET/);
    spies.forEach((s) => s.mockRestore());
  });
});
