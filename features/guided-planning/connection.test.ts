import { describe, expect, it } from "vitest";
import { resolveConnection } from "./connection";

const env = { AZURE_OPENAI_API_KEY: "ENV-KEY", AZURE_OPENAI_ENDPOINT: "https://env.openai.azure.com", AZURE_OPENAI_DEPLOYMENT: "env-dep" };
const fromBrowser = { apiKey: "BROWSER-KEY", endpoint: "https://b.openai.azure.com", deployment: "b-dep" };
const empty = { apiKey: "", endpoint: "", deployment: "" };

describe("LLM 연결 정보 정하기", () => {
  it("서버에 설정이 있으면 브라우저가 보낸 값과 상관없이 서버 설정을 쓴다", () => {
    expect(resolveConnection(empty, env)).toEqual({ apiKey: "ENV-KEY", endpoint: "https://env.openai.azure.com", deployment: "env-dep" });
    expect(resolveConnection(fromBrowser, env).apiKey).toBe("ENV-KEY");
  });

  it("서버 설정이 세 가지 중 하나라도 비어 있으면 브라우저가 보낸 값을 쓴다", () => {
    expect(resolveConnection(fromBrowser, { ...env, AZURE_OPENAI_DEPLOYMENT: "" })).toEqual(fromBrowser);
    expect(resolveConnection(fromBrowser, {})).toEqual(fromBrowser);
  });

  it("서버 설정도 브라우저 값도 없으면 빈 값을 그대로 돌려줘 호출 쪽이 키 오류로 알리게 한다", () => {
    expect(resolveConnection(empty, {})).toEqual(empty);
  });

  it("값 앞뒤 공백과 따옴표는 다듬어 쓴다", () => {
    expect(resolveConnection(empty, { ...env, AZURE_OPENAI_API_KEY: '  "ENV-KEY"  ' }).apiKey).toBe("ENV-KEY");
  });
});
