import { handleAgentRequest } from "@/features/guided-planning/server";

// 사용자가 보낸 연결 정보는 이 요청 안에서만 쓰고 저장하거나 로그로 남기지 않는다.
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 본문이 JSON이 아니면 invalid로 처리된다.
  }
  const result = await handleAgentRequest(body);
  return Response.json(result, { status: result.ok ? 200 : result.code === "invalid" ? 400 : 502 });
}
