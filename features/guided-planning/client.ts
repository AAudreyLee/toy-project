import type { AgentResponse } from "./agent";

export type { AgentResponse, Idea } from "./agent";

export async function callAgent(body: Record<string, unknown>): Promise<AgentResponse> {
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as AgentResponse;
  } catch {
    return { ok: false, code: "failed", message: "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." };
  }
}
