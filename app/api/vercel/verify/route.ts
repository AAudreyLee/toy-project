import { DeliveryError } from "@/features/guided-planning/delivery/errors";
import { verifyVercelToken } from "@/features/guided-planning/delivery/vercel";

// 사용자가 붙여 넣은 Vercel 토큰은 이 요청 안에서만 쓰고 저장하거나 로그로 남기지 않는다.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return Response.json({ ok: false, code: "vercel-auth", message: "토큰을 붙여 넣어 주세요." }, { status: 400 });
  try {
    const { name } = await verifyVercelToken(token);
    return Response.json({ ok: true, name });
  } catch (e) {
    const code = e instanceof DeliveryError ? e.code : "failed";
    const message = e instanceof DeliveryError ? e.message : "Vercel에 연결하지 못했어요.";
    return Response.json({ ok: false, code, message }, { status: 502 });
  }
}
