import { cookies } from "next/headers";

import { getGithubUser } from "@/features/guided-planning/delivery/github";

export async function GET() {
  const store = await cookies();
  const token = store.get("gh_token")?.value;
  if (!token) return Response.json({ connected: false });
  try {
    const user = await getGithubUser(token);
    return Response.json({ connected: true, login: user.login });
  } catch {
    // 만료되었거나 거부된 권한은 지우고 연결되지 않은 상태로 알린다.
    store.delete("gh_token");
    return Response.json({ connected: false, expired: true });
  }
}

export async function DELETE() {
  const store = await cookies();
  store.delete("gh_token");
  return Response.json({ connected: false });
}
