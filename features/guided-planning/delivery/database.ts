import { DeliveryError } from "./errors";

const API = "https://api.vercel.com";
const REGION = "iad1";
const ALL_ENVIRONMENTS = ["production", "preview", "development"];

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function url(path: string, teamId: string | null, extra = ""): string {
  const query = [extra, teamId ? `teamId=${teamId}` : ""].filter(Boolean).join("&");
  return `${API}${path}${query ? `?${query}` : ""}`;
}

type VercelBody = { error?: { code?: string; message?: string; invalidToken?: boolean; missingToken?: boolean } };

async function readError(res: Response): Promise<{ code: string; message: string; invalid: boolean }> {
  const d = ((await res.json().catch(() => ({}))) as VercelBody).error ?? {};
  return { code: d.code ?? "", message: d.message ?? "", invalid: Boolean(d.invalidToken || d.missingToken) };
}

const authError = () => new DeliveryError("vercel-auth", "Vercel 토큰으로 데이터베이스를 만들 수 없어요. 다시 연결해 주세요.");

/** 프로젝트를 가진 팀의 ID. 개인 계정 소유면 null이다. */
export async function getProjectOwner(token: string, projectId: string, f: typeof fetch = fetch): Promise<string | null> {
  const res = await f(url(`/v9/projects/${projectId}`, null), { headers: headers(token) });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw authError();
    throw new DeliveryError("failed", `Vercel 프로젝트 정보를 읽지 못했어요 (${res.status}).`);
  }
  const d = (await res.json()) as { accountId?: string };
  return d.accountId?.startsWith("team_") ? d.accountId : null;
}

/** 사용자의 Vercel 팀에 Neon 연동이 설치되어 있는지 확인한다. */
export async function findNeon(token: string, teamId: string | null, f: typeof fetch = fetch): Promise<{ id: string }> {
  const res = await f(url("/v1/integrations/configurations", teamId, "view=account&integrationIdOrSlug=neon"), { headers: headers(token) });
  if (!res.ok) {
    const e = await readError(res);
    if (res.status === 401 || res.status === 403 || e.invalid) throw authError();
    throw new DeliveryError("failed", `Neon 연동을 확인하지 못했어요 (${res.status}).`);
  }
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : ((body as { configurations?: unknown[] }).configurations ?? [])) as { id: string; slug?: string }[];
  const neon = list.find((c) => c.slug === "neon");
  if (!neon) {
    throw new DeliveryError(
      "neon-missing",
      "내 Vercel 팀에 Neon이 아직 설치되어 있지 않아요. Vercel 대시보드의 Storage에서 Neon을 한 번 설치(약관 동의)한 뒤 다시 확인해 주세요.",
    );
  }
  return { id: neon.id };
}

/** 사용자 팀에 새 Neon 데이터베이스를 만든다. 플랜은 무료로 자동 선택된다. */
export async function createDatabase(
  token: string,
  o: { teamId: string | null; configurationId: string; name: string },
  f: typeof fetch = fetch,
): Promise<{ id: string }> {
  const res = await f(url("/v1/storage/stores/integration/direct", o.teamId), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      name: o.name,
      integrationConfigurationId: o.configurationId,
      integrationProductIdOrSlug: "neon",
      metadata: { region: REGION, auth: false },
    }),
  });
  if (!res.ok) {
    const e = await readError(res);
    if (res.status === 401 || e.invalid) throw authError();
    if (res.status === 402) {
      throw new DeliveryError("failed", "데이터베이스를 만들려면 Vercel에 결제 수단이 필요해요. Vercel 계정의 결제 설정을 확인한 뒤 다시 시도해 주세요.");
    }
    throw new DeliveryError("failed", `데이터베이스를 만들지 못했어요 (${res.status}). ${e.message}`.trim());
  }
  const d = (await res.json()) as { store?: { id?: string } | null };
  if (!d.store?.id) throw new DeliveryError("failed", "데이터베이스를 만들지 못했어요. 응답에 데이터베이스 정보가 없어요.");
  return { id: d.store.id };
}

/** 만든 데이터베이스를 배포 프로젝트에 연결한다. 접속 정보는 Vercel이 프로젝트 환경 변수로 넣는다. */
export async function connectDatabase(
  token: string,
  o: { teamId: string | null; configurationId: string; databaseId: string; projectId: string },
  f: typeof fetch = fetch,
): Promise<void> {
  const res = await f(url(`/v1/integrations/installations/${o.configurationId}/resources/${o.databaseId}/connections`, o.teamId), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ projectId: o.projectId, envVarEnvironments: ALL_ENVIRONMENTS }),
  });
  if (res.ok) return;
  const e = await readError(res);
  // 이전 시도에서 이미 연결됐다면 다시 연결하지 않고 이어간다.
  if (e.code === "env_var_prefix_not_unique") return;
  if (res.status === 401 || e.invalid) throw authError();
  throw new DeliveryError("failed", `데이터베이스를 프로젝트에 연결하지 못했어요 (${res.status}). ${e.message}`.trim());
}

/** 이 데이터베이스가 이미 프로젝트에 연결되어 있는지(접속 정보가 환경 변수로 들어와 있는지) 확인한다. 알 수 없으면 false다. */
export async function isDatabaseConnected(
  token: string,
  o: { teamId: string | null; projectId: string; databaseId: string },
  f: typeof fetch = fetch,
): Promise<boolean> {
  const res = await f(url(`/v9/projects/${o.projectId}/env`, o.teamId), { headers: headers(token) });
  if (!res.ok) return false;
  const d = (await res.json()) as { envs?: { contentHint?: { storeId?: string } }[] };
  return (d.envs ?? []).some((e) => e.contentHint?.storeId === o.databaseId);
}
