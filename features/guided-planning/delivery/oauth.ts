import { DeliveryError } from "./errors";
import { buildAuthorizeUrl, exchangeCode } from "./github";

export type GithubApp = { clientId: string; clientSecret: string };

const CALLBACK_PATH = "/api/github/callback";

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startGithubLogin(origin: string, app: GithubApp): { url: string; state: string } {
  if (!app.clientId || !app.clientSecret) throw new DeliveryError("github-auth", "서비스의 GitHub 연결 설정이 아직 없어요.");
  const state = randomState();
  return { url: buildAuthorizeUrl(app.clientId, `${origin}${CALLBACK_PATH}`, state), state };
}

export async function finishGithubLogin(
  input: { origin: string; code: string; state: string; expectedState: string | undefined },
  app: GithubApp,
  f: typeof fetch = fetch,
): Promise<string> {
  if (!input.state || !input.expectedState || input.state !== input.expectedState) {
    throw new DeliveryError("github-auth", "연결 요청을 확인하지 못했어요. 처음부터 다시 연결해 주세요.");
  }
  if (!input.code) throw new DeliveryError("github-auth", "GitHub 승인이 취소되었어요. 다시 연결해 주세요.");
  return exchangeCode({ clientId: app.clientId, clientSecret: app.clientSecret, code: input.code, redirectUri: `${input.origin}${CALLBACK_PATH}` }, f);
}
