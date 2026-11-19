import type { Connection } from "./types";

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

/**
 * LLM 호출에 쓸 연결 정보를 정한다. 서버 환경 변수(.env.local)에 세 가지가 모두 있으면 그것을 쓰고,
 * 하나라도 없으면 브라우저가 보낸 값을 그대로 쓴다.
 */
export function resolveConnection(fromRequest: Connection, env: Env = process.env): Connection {
  const apiKey = clean(env.AZURE_OPENAI_API_KEY);
  const endpoint = clean(env.AZURE_OPENAI_ENDPOINT);
  const deployment = clean(env.AZURE_OPENAI_DEPLOYMENT);
  return apiKey && endpoint && deployment ? { apiKey, endpoint, deployment } : fromRequest;
}
