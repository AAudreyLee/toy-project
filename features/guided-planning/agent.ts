import { DIRECTION_LABELS, SPEC_LABELS } from "./documents";
import { ideaViolations } from "./idea-guard";
import { specViolations } from "./spec-guard";
import { chatSystemPrompt, type ChatInput, ideasPrompt, KICKOFF_MESSAGE, reflectMessage } from "./prompts";
import type { AgentReply, ChatMessage, Connection, DirectionDoc, SpecDoc, Stage } from "./types";

export type Idea = { title: string; summary: string };

export type AgentResponse =
  | { ok: true; kind: "verify" }
  | { ok: true; kind: "ideas"; ideas: Idea[] }
  | { ok: true; kind: "chat"; reply: AgentReply }
  | { ok: false; code: "key" | "failed" | "invalid"; message: string };

const API_VERSION = "2024-10-21";
const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;

class AgentError extends Error {
  constructor(
    readonly code: "key" | "failed" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 객체가 없습니다");
  return JSON.parse(body.slice(start, end + 1));
}

export function parseAgentReply(stage: Stage, text: string): AgentReply {
  const raw = extractJson(text) as { message?: unknown; doc?: Record<string, unknown> };
  if (typeof raw.message !== "string" || !raw.message.trim()) throw new Error("message가 없습니다");
  const labels: Record<string, string> = stage === "direction" ? DIRECTION_LABELS : SPEC_LABELS;
  const doc: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw.doc ?? {})) {
    if (!(key in labels)) continue;
    if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
      if (items.length) doc[key] = items;
    } else if (typeof value === "string" && value.trim()) {
      doc[key] = value.trim();
    }
  }
  return { message: raw.message.trim(), doc } as AgentReply;
}

export function parseIdeas(text: string): Idea[] {
  const raw = extractJson(text) as { ideas?: { title?: unknown; summary?: unknown }[] };
  const ideas = (raw.ideas ?? [])
    .filter((i) => typeof i.title === "string" && typeof i.summary === "string" && i.title.trim() && i.summary.trim())
    .map((i) => ({ title: String(i.title).trim(), summary: String(i.summary).trim() }));
  if (ideas.length !== 3) throw new Error("아이디어가 3개가 아닙니다");
  return ideas;
}

type WireMessage = { role: "system" | "user" | "assistant"; content: string };

async function callAzure(
  c: Connection,
  messages: WireMessage[],
  opts: { json: boolean; maxTokens: number },
  fetchImpl: typeof fetch,
): Promise<string> {
  const endpoint = c.endpoint.trim().replace(/\/+$/, "");
  if (!c.apiKey.trim() || !c.deployment.trim() || !endpoint.startsWith("https://")) {
    throw new AgentError("key", "키, 엔드포인트, 배포 이름을 확인해 주세요.");
  }
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(c.deployment.trim())}/chat/completions?api-version=${API_VERSION}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "api-key": c.apiKey.trim(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        max_completion_tokens: opts.maxTokens,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AgentError("failed", "Azure OpenAI에 연결하지 못했어요.");
  }
  if ([401, 403, 404, 429].includes(res.status)) {
    throw new AgentError("key", "입력한 정보가 거부되었어요. 키가 만료되었거나 한도를 넘었을 수 있어요.");
  }
  if (!res.ok) throw new AgentError("failed", `Azure OpenAI가 오류를 돌려줬어요 (${res.status}).`);
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new AgentError("failed", "Azure OpenAI의 응답을 읽지 못했어요.");
  }
}

function specProblems(input: ChatInput, reply: AgentReply): string[] {
  const touched = Object.keys(reply.doc);
  if (input.reflect && !touched.length) return ["바뀐 서비스 방향에 맞춰 Spec 문서의 해당 항목을 실제로 고쳐서 doc에 담아 주세요."];
  if (!touched.length) return [];
  return specViolations({ ...(input.doc as SpecDoc), ...(reply.doc as Partial<SpecDoc>) });
}

function asConnection(v: unknown): Connection {
  const c = (v ?? {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  return { apiKey: s(c.apiKey), endpoint: s(c.endpoint), deployment: s(c.deployment) };
}

function wireMessages(input: ChatInput, history: ChatMessage[]): WireMessage[] {
  const wire: WireMessage[] = [{ role: "system", content: chatSystemPrompt(input) }];
  for (const m of history) wire.push({ role: m.role === "agent" ? "assistant" : "user", content: m.text });
  if (input.reflect) wire.push({ role: "user", content: reflectMessage(input.reflect) });
  else if (!history.length) wire.push({ role: "user", content: KICKOFF_MESSAGE });
  return wire;
}

async function run(body: unknown, fetchImpl: typeof fetch): Promise<AgentResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const connection = asConnection(b.connection);

  if (b.kind === "verify") {
    await callAzure(connection, [{ role: "user", content: "ping" }], { json: false, maxTokens: 16 }, fetchImpl);
    return { ok: true, kind: "verify" };
  }

  if (b.kind === "ideas") {
    const materials = Array.isArray(b.materials) ? b.materials.filter((m): m is string => typeof m === "string" && !!m.trim()) : [];
    if (!materials.length) throw new AgentError("invalid", "재료를 하나 이상 골라 주세요.");
    const avoid = Array.isArray(b.avoid) ? b.avoid.filter((m): m is string => typeof m === "string") : [];
    const { system, user } = ideasPrompt(materials, avoid);
    const wire: WireMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    // 고르지 않은 재료가 필요한 아이디어가 나오면 이유를 알려 주고 최대 두 번 다시 받는다.
    for (let attempt = 0; ; attempt++) {
      const text = await callAzure(connection, wire, { json: true, maxTokens: 4000 }, fetchImpl);
      let ideas: Idea[];
      try {
        ideas = parseIdeas(text);
      } catch {
        throw new AgentError("failed", "agent의 답을 이해하지 못했어요.");
      }
      const problems = ideaViolations(ideas, materials);
      if (!problems.length || attempt >= MAX_RETRIES) return { ok: true, kind: "ideas", ideas };
      wire.push(
        { role: "assistant", content: text },
        { role: "user", content: `${problems.join("\n")}\n이 점을 고쳐서 같은 JSON 형식으로 다시 답해 주세요.` },
      );
    }
  }

  if (b.kind === "chat") {
    if (b.stage !== "direction" && b.stage !== "spec") throw new AgentError("invalid", "알 수 없는 단계입니다.");
    const history = Array.isArray(b.messages)
      ? (b.messages as ChatMessage[]).filter((m) => m && (m.role === "agent" || m.role === "user") && typeof m.text === "string")
      : [];
    const input: ChatInput = {
      stage: b.stage,
      projectName: typeof b.projectName === "string" ? b.projectName : "",
      idea: typeof b.idea === "string" ? b.idea : "",
      doc: (b.doc ?? {}) as DirectionDoc | SpecDoc,
      direction: b.direction as DirectionDoc | undefined,
      reflect: typeof b.reflect === "string" && b.reflect.trim() ? b.reflect : undefined,
    };
    const wire = wireMessages(input, history);
    // 3단계 Spec이 규칙에서 벗어나면 이유를 알려 주고 최대 두 번 다시 받는다.
    for (let attempt = 0; ; attempt++) {
      const text = await callAzure(connection, wire, { json: true, maxTokens: 4000 }, fetchImpl);
      let reply: AgentReply;
      try {
        reply = parseAgentReply(b.stage, text);
      } catch {
        throw new AgentError("failed", "agent의 답을 이해하지 못했어요.");
      }
      const problems = input.stage === "spec" ? specProblems(input, reply) : [];
      if (!problems.length || attempt >= MAX_RETRIES) return { ok: true, kind: "chat", reply };
      wire.push(
        { role: "assistant", content: text },
        { role: "user", content: `${problems.join("\n")}
이 점을 고쳐서 같은 JSON 형식으로 다시 답해 주세요.` },
      );
    }
  }

  throw new AgentError("invalid", "알 수 없는 요청입니다.");
}

export async function handleAgentRequest(body: unknown, fetchImpl: typeof fetch = fetch): Promise<AgentResponse> {
  try {
    return await run(body, fetchImpl);
  } catch (e) {
    if (e instanceof AgentError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "failed", message: "알 수 없는 오류가 났어요." };
  }
}
