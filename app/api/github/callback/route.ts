import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { finishGithubLogin } from "@/features/guided-planning/delivery/oauth";

// 받은 접근 권한은 스크립트가 읽을 수 없는 쿠키에만 담고, 서버에는 저장하지 않는다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const store = await cookies();
  const expectedState = store.get("gh_oauth_state")?.value;
  store.delete("gh_oauth_state");
  try {
    const token = await finishGithubLogin(
      { origin, code: url.searchParams.get("code") ?? "", state: url.searchParams.get("state") ?? "", expectedState },
      { clientId: process.env.GITHUB_CLIENT_ID ?? "", clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "" },
    );
    store.set("gh_token", token, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/", maxAge: 60 * 60 * 8 });
    return NextResponse.redirect(`${origin}/?github=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/?github=error`);
  }
}
