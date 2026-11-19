import { cookies } from "next/headers";

import { DeliveryError } from "@/features/guided-planning/delivery/errors";
import { getGithubUser } from "@/features/guided-planning/delivery/github";

export async function GET() {
  const store = await cookies();
  const token = store.get("gh_token")?.value;
  if (!token) return Response.json({ connected: false });
  try {
    const user = await getGithubUser(token);
    return Response.json({ connected: true, login: user.login });
  } catch (e) {
    // 만료되었거나 거부된 권한만 지운다. GitHub 일시 오류로 연결을 끊지 않는다.
    if (e instanceof DeliveryError && e.code === "github-auth") {
      store.delete("gh_token");
      return Response.json({ connected: false, expired: true });
    }
    return Response.json({ connected: true, unknown: true });
  }
}

export async function DELETE() {
  const store = await cookies();
  store.delete("gh_token");
  return Response.json({ connected: false });
}
