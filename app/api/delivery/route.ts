import { cookies } from "next/headers";

import { handleDeliveryRequest } from "@/features/guided-planning/delivery/server";

export const maxDuration = 300;

// 요청에 담긴 키와 토큰은 이 요청 안에서만 쓰고 저장하거나 로그로 남기지 않는다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const store = await cookies();
  const result = await handleDeliveryRequest(body, { githubToken: store.get("gh_token")?.value });
  if (!result.ok && result.code === "github-auth") store.delete("gh_token");
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
