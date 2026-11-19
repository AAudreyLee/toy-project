import type { DeliveryApi } from "./run";

export const callDelivery: DeliveryApi = async (req) => {
  try {
    const res = await fetch("/api/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    return (await res.json()) as never;
  } catch {
    return { ok: false, code: "failed", message: "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." } as never;
  }
};

export type GithubStatus = { connected: boolean; login?: string; expired?: boolean };

export async function getGithubStatus(): Promise<GithubStatus> {
  try {
    return (await (await fetch("/api/github/status")).json()) as GithubStatus;
  } catch {
    return { connected: false };
  }
}

export async function disconnectGithub(): Promise<void> {
  await fetch("/api/github/status", { method: "DELETE" }).catch(() => {});
}

export async function verifyVercel(token: string): Promise<{ ok: true; name: string | null } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/vercel/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    return (await res.json()) as never;
  } catch {
    return { ok: false, message: "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." };
  }
}
