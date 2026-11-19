import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { startGithubLogin } from "@/features/guided-planning/delivery/oauth";

// GitHub 승인 화면으로 보낸다. 상태값은 돌아왔을 때 확인하려고 쿠키에 잠깐 둔다.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  try {
    const { url, state } = startGithubLogin(origin, {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    });
    const store = await cookies();
    store.set("gh_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/", maxAge: 600 });
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(`${origin}/?github=error`);
  }
}
