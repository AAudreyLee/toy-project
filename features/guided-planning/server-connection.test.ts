import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAgentRequest } from "./agent";
import { handleDeliveryRequest } from "./delivery/server";

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ supported: true, reason: "", hint: "" }) } }] }), { status: 200 });
type Call = [string, RequestInit];

function useEnv() {
  vi.stubEnv("AZURE_OPENAI_API_KEY", "ENV-KEY");
  vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://env.openai.azure.com");
  vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "env-dep");
}
afterEach(() => vi.unstubAllEnvs());

describe("서버 설정으로 LLM을 부르기", () => {
  it("에이전트 요청에 연결 정보가 없어도 서버 설정으로 Azure OpenAI를 부른다", async () => {
    useEnv();
    const f = vi.fn(async () => ok());
    const res = await handleAgentRequest({ kind: "verify" }, f as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: true });
    const [url, init] = (f.mock.calls as unknown as Call[])[0];
    expect(url).toContain("https://env.openai.azure.com/openai/deployments/env-dep/");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("ENV-KEY");
  });

  it("구현·배포 요청도 서버 설정을 쓰고, 브라우저가 보낸 키는 쓰지 않는다", async () => {
    useEnv();
    const f = vi.fn(async () => ok());
    const spec = { result: "r", scope: ["s"], verification: ["v"], notNow: "n" };
    const direction = { oneLine: "o", usersSituation: "u", problemAlternatives: "p", promisedChange: "c", coreLoop: "l" };
    const res = await handleDeliveryRequest({ kind: "plan", connection: { apiKey: "BROWSER", endpoint: "https://b.openai.azure.com", deployment: "b" }, spec, direction }, {}, f as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: true, supported: true });
    const [url, init] = (f.mock.calls as unknown as Call[])[0];
    expect(url).toContain("env.openai.azure.com");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("ENV-KEY");
  });

  it("서버 설정이 없으면 이전처럼 브라우저가 보낸 연결 정보를 쓴다", async () => {
    const f = vi.fn(async () => ok());
    await handleAgentRequest({ kind: "verify", connection: { apiKey: "BROWSER", endpoint: "https://b.openai.azure.com", deployment: "b" } }, f as unknown as typeof fetch);
    expect((f.mock.calls as unknown as Call[])[0][0]).toContain("b.openai.azure.com");
  });
});
