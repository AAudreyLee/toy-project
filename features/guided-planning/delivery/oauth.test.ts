import { describe, expect, it, vi } from "vitest";
import { finishGithubLogin, startGithubLogin } from "./oauth";

const env = { clientId: "cid", clientSecret: "sec" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("GitHub 연결 시작", () => {
  it("매번 다른 상태값을 만들고 그 값이 승인 주소에도 담긴다", () => {
    const a = startGithubLogin("http://localhost:3000", env);
    const b = startGithubLogin("http://localhost:3000", env);
    expect(a.state).not.toBe(b.state);
    expect(new URL(a.url).searchParams.get("state")).toBe(a.state);
    expect(new URL(a.url).searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/github/callback");
  });

  it("서버에 GitHub 앱 정보가 없으면 설정 오류로 알린다", () => {
    expect(() => startGithubLogin("http://localhost:3000", { clientId: "", clientSecret: "" })).toThrow(/GitHub/);
  });
});

describe("GitHub 연결 마무리", () => {
  it("상태값이 맞으면 승인 코드를 접근 권한으로 바꿔 돌려준다", async () => {
    const f = vi.fn(async () => json({ access_token: "gho_ok" }));
    await expect(finishGithubLogin({ origin: "http://localhost:3000", code: "c", state: "s", expectedState: "s" }, env, f as unknown as typeof fetch)).resolves.toBe("gho_ok");
  });

  it("상태값이 다르거나 없으면 코드를 바꾸지 않고 거부한다", async () => {
    const f = vi.fn();
    for (const [state, expected] of [["a", "b"], ["", ""], ["a", undefined]] as const) {
      await expect(finishGithubLogin({ origin: "http://x", code: "c", state, expectedState: expected }, env, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "github-auth" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("사용자가 승인을 취소해 코드가 없으면 연결 오류로 알린다", async () => {
    await expect(finishGithubLogin({ origin: "http://x", code: "", state: "s", expectedState: "s" }, env, vi.fn() as unknown as typeof fetch)).rejects.toMatchObject({ code: "github-auth" });
  });
});
