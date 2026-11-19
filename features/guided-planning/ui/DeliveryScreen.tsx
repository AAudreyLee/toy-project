"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { callDelivery, disconnectGithub, getGithubStatus, verifyVercel, type GithubStatus } from "../delivery/client";
import { runDelivery } from "../delivery/run";
import { isValidRepoName, userFacingStage } from "../delivery/state";
import type { Connection, DeliveryState, DeliveryStep, Progress } from "../types";
import type { VercelConnection } from "../storage";

type Support = { status: "checking" } | { status: "ok"; needsDatabase: boolean } | { status: "unsupported"; reason: string; hint: string } | { status: "error"; message: string };

const STAGES: { label: string; steps: DeliveryStep[] }[] = [
  { label: "코드 만들기", steps: ["generate"] },
  { label: "저장소 만들기", steps: ["repo"] },
  { label: "올리기", steps: ["push"] },
  { label: "데이터베이스", steps: ["database"] },
  { label: "배포", steps: ["project", "deploy"] },
  { label: "확인", steps: ["verify"] },
];

function stageState(d: DeliveryState, steps: DeliveryStep[]): "done" | "running" | "failed" | "pending" {
  if (d.error && steps.includes(d.error.step)) return "failed";
  if (d.running && steps.includes(d.running)) return "running";
  if (steps.every((s) => d.done.includes(s))) return "done";
  return "pending";
}

const MARK = { done: "✓", running: "…", failed: "!", pending: "·" } as const;

export function DeliveryScreen({
  progress,
  connection,
  vercel,
  githubFlash,
  onVercel,
  onProgress,
  onBackToSpec,
  onKeyProblem,
}: {
  progress: Progress;
  connection: Connection;
  vercel: VercelConnection | null;
  githubFlash: "connected" | "error" | null;
  onVercel: (v: VercelConnection | null) => void;
  onProgress: (update: (p: Progress) => Progress) => void;
  onBackToSpec: () => void;
  onKeyProblem: () => void;
}) {
  const d = progress.delivery;
  const [github, setGithub] = useState<GithubStatus | null>(null);
    const [repoName, setRepoName] = useState(d.repoName);
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenChecking, setTokenChecking] = useState(false);
  const [help, setHelp] = useState(false);
  const inflight = useRef(false);
  const delivered = Boolean(d.repoUrl);
  // 이미 저장소까지 만든 뒤에는 판정을 다시 하지 않고, 처음 판정한 결과로 이어서 진행한다.
  const [support, setSupport] = useState<Support>(delivered ? { status: "ok", needsDatabase: d.needsDatabase === true } : { status: "checking" });

  useEffect(() => {
    void getGithubStatus().then(setGithub);
  }, []);

  const specKey = JSON.stringify([progress.spec.doc, progress.direction.doc]);
  useEffect(() => {
    if (delivered || d.running) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport({ status: "checking" });
    void callDelivery({ kind: "plan", connection, spec: progress.spec.doc, direction: progress.direction.doc }).then((r) => {
      if (cancelled) return;
      if (!r.ok) setSupport({ status: "error", message: String(r.message) });
      else if (r.supported === true) setSupport({ status: "ok", needsDatabase: r.needsDatabase === true });
      else setSupport({ status: "unsupported", reason: String(r.reason ?? ""), hint: String(r.hint ?? "") });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, delivered]);

  async function connectVercel() {
    if (!token.trim()) {
      setTokenError("토큰을 붙여 넣어 주세요.");
      return;
    }
    setTokenChecking(true);
    setTokenError(null);
    const r = await verifyVercel(token.trim());
    setTokenChecking(false);
    if (r.ok) {
      onVercel({ token: token.trim(), name: r.name });
      setToken("");
    } else {
      setTokenError(r.message);
    }
  }

  async function start() {
    if (inflight.current || !vercel) return;
    inflight.current = true;
    try {
      await runDelivery({
        api: callDelivery,
        delivery: d,
        spec: progress.spec.doc,
        direction: progress.direction.doc,
        connection,
        vercelToken: vercel.token,
        repoName,
        needsDatabase,
        onChange: (next) => onProgress((p) => ({ ...p, delivery: next })),
      });
    } finally {
      inflight.current = false;
      void getGithubStatus().then(setGithub);
    }
  }

  const needsDatabase = support.status === "ok" && support.needsDatabase;
  const stages = STAGES.filter((s) => !s.steps.includes("database") || needsDatabase || d.needsDatabase);
  const nameValid = isValidRepoName(repoName);
  const connected = Boolean(github?.connected) && Boolean(vercel);
  const canStart = connected && support.status === "ok" && nameValid && !d.running && !d.verified;
  const keyError = d.error?.code === "failed" && /키|Azure/.test(d.error.message);

  return (
    <div className="flex flex-col gap-4">
      {githubFlash === "error" && (
        <Alert variant="destructive">
          <AlertTitle>GitHub에 연결하지 못했어요</AlertTitle>
          <AlertDescription>승인을 취소했거나 연결이 확인되지 않았어요. 다시 연결해 주세요.</AlertDescription>
        </Alert>
      )}

      {progress.review[4] && (
        <Alert className="border-primary/45 bg-primary/10">
          <AlertTitle>앞 단계가 바뀌어서 이 결과를 다시 확인해야 해요</AlertTitle>
          <AlertDescription>
            <span className="whitespace-pre-line">바뀐 부분: {progress.changeNote || "서비스 방향이나 첫 Spec이 바뀌었어요."}</span>
            <span className="mt-1 block">이미 만든 저장소와 배포는 그대로 남아 있어요. 이번 업데이트에서는 바뀐 내용으로 다시 만드는 기능이 아직 없어요.</span>
            <span className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onProgress((p) => ({ ...p, review: { ...p.review, 4: false } }))}>
                확인했어요
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {d.verified && d.deployUrl && (
        <Card>
          <CardHeader>
            <Badge className="w-fit">배포 완료</Badge>
            <CardTitle className="text-lg">내가 만든 시스템이 배포됐어요</CardTitle>
            <CardDescription>아래 배포 주소를 열어 첫 Spec의 확인 방법대로 직접 확인해 보세요. 만든 기술: Next.js</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              배포 주소:{" "}
              <a className="font-medium underline underline-offset-4" href={d.deployUrl} target="_blank" rel="noopener noreferrer">
                {d.deployUrl}
              </a>
            </p>
            {d.repoUrl && (
              <p>
                저장소:{" "}
                <a className="font-medium underline underline-offset-4" href={d.repoUrl} target="_blank" rel="noopener noreferrer">
                  {d.repoUrl}
                </a>
              </p>
            )}
            <div>
              <h4 className="font-semibold">확인 방법</h4>
              <ul className="list-disc pl-5">
                {progress.spec.doc.verification.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {!d.verified && (
        <>
          {!delivered && support.status === "checking" && (
            <p role="status" className="text-sm text-muted-foreground">
              첫 Spec을 만들 수 있는지 확인하고 있어요…
            </p>
          )}
          {!delivered && support.status === "unsupported" && (
            <Alert variant="destructive">
              <AlertTitle>이번엔 만들 수 없어요</AlertTitle>
              <AlertDescription>
                {support.reason}
                {support.hint && <span className="mt-1 block">{support.hint}</span>}
                <span className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={onBackToSpec}>
                    3단계로 돌아가 Spec 고치기
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          )}
          {!delivered && support.status === "error" && (
            <Alert variant="destructive">
              <AlertTitle>만들 수 있는지 확인하지 못했어요</AlertTitle>
              <AlertDescription>
                {support.message}
                <span className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSupport({ status: "checking" })}>
                    다시 확인
                  </Button>
                  <Button size="sm" variant="outline" onClick={onKeyProblem}>
                    API 키 변경
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. 계정 연결</CardTitle>
              <CardDescription>내 GitHub와 Vercel에 올리고 배포하려면 두 계정을 연결해 주세요.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm font-medium">GitHub</span>
                {github?.connected ? (
                  <>
                    <Badge variant="secondary">GitHub 연결됨{github.login ? ` · ${github.login}` : ""}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await disconnectGithub();
                        setGithub({ connected: false });
                      }}
                    >
                      연결 해제
                    </Button>
                  </>
                ) : (
                  <a className={buttonVariants({ size: "sm" })} href="/api/github/connect">
                    GitHub로 연결
                  </a>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-sm font-medium">Vercel</span>
                  {vercel ? (
                    <>
                      <Badge variant="secondary">Vercel 연결됨{vercel.name ? ` · ${vercel.name}` : ""}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => onVercel(null)}>
                        연결 해제
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Vercel에서 발급한 토큰을 붙여 넣어 연결해요.</span>
                  )}
                </div>
                {!vercel && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void connectVercel();
                    }}
                  >
                    <Field>
                      <FieldLabel htmlFor="vercelToken">Vercel 토큰</FieldLabel>
                      <Input
                        id="vercelToken"
                        type="password"
                        autoComplete="off"
                        placeholder="vcp_로 시작하는 토큰"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        aria-invalid={!!tokenError}
                      />
                      <FieldDescription>토큰은 이 브라우저에만 저장되고, 서비스 서버에는 보관하지 않아요.</FieldDescription>
                    </Field>
                    {tokenError && (
                      <Alert variant="destructive">
                        <AlertTitle>토큰을 확인하지 못했어요</AlertTitle>
                        <AlertDescription>{tokenError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" disabled={tokenChecking}>
                        {tokenChecking ? "확인하는 중…" : "연결"}
                      </Button>
                      <Button type="button" size="sm" variant="link" onClick={() => setHelp((v) => !v)}>
                        토큰은 어디서 받나요?
                      </Button>
                    </div>
                    {help && (
                      <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                        Vercel에 로그인한 뒤 계정 설정의 Tokens 메뉴(vercel.com/account/tokens)에서 새 토큰을 만드세요. 이름을 적고 Scope는 &apos;Full Account&apos; 또는 팀 전체(All Projects)로 고른 뒤 만들고, 나오는 토큰을 바로 복사해 여기에 붙여 넣으세요. 특정 프로젝트 하나로 한정한 토큰은 새 프로젝트를 만들 수 없어서 쓸 수 없어요. 토큰은 한 번만 보여요.
                      </div>
                    )}
                  </form>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. 만들고 올리기</CardTitle>
              <CardDescription>agent가 첫 Spec으로 코드를 만들어 새 비공개 저장소에 올리고 Vercel에 배포해요. 누르기 전에는 계정에 아무것도 생기지 않아요.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="repoName">저장소 이름</FieldLabel>
                <Input
                  id="repoName"
                  value={repoName}
                  disabled={delivered || !!d.running}
                  onChange={(e) => setRepoName(e.target.value)}
                  aria-invalid={!nameValid || d.error?.code === "name-taken"}
                />
                <FieldDescription>
                  {!nameValid ? "영문, 숫자, 하이픈, 밑줄, 점만 쓸 수 있어요." : "GitHub에 이 이름의 비공개 저장소가 만들어져요."}
                </FieldDescription>
              </Field>

              {needsDatabase && !d.verified && (
                <Alert>
                  <AlertTitle>이 시스템은 데이터를 서버에 저장해요</AlertTitle>
                  <AlertDescription>
                    누르면 내 Vercel 팀에 새 데이터베이스(Neon)가 만들어지고 이 시스템에 연결돼요. 로그인이 없어서, 배포 주소를 아는 누구나 이 데이터를 보고 고칠 수 있어요.
                  </AlertDescription>
                </Alert>
              )}

              {(d.running || d.done.length > 0 || d.error) && (
                <ol className="flex flex-col gap-1 text-sm" aria-label="진행 상황">
                  {stages.map((s) => {
                    const st = stageState(d, s.steps);
                    return (
                      <li key={s.label} className="flex items-center gap-2" data-state={st}>
                        <span className="w-4 text-center">{MARK[st]}</span>
                        <span className={st === "pending" ? "text-muted-foreground" : ""}>
                          {st === "running" && d.running ? userFacingStage(d.running) : s.label}
                          {st === "done" ? " 완료" : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {d.error && (
                <Alert variant="destructive">
                  <AlertTitle>{d.interrupted ? "진행이 중단됐어요" : "여기서 멈췄어요"}</AlertTitle>
                  <AlertDescription>
                    {d.error.message}
                    {d.repoUrl && <span className="mt-1 block">이미 만든 저장소는 그대로 남아 있어요: {d.repoUrl}</span>}
                    {d.error.code === "neon-missing" && (
                      <span className="mt-1 block">
                        <a className="underline underline-offset-4" href="https://vercel.com/marketplace/neon" target="_blank" rel="noopener noreferrer">
                          Vercel에서 Neon 설치하기
                        </a>
                        <span className="mt-1 block">설치를 마쳤다면 아래 &quot;다시 확인&quot;을 눌러 이어서 진행해요.</span>
                      </span>
                    )}
                    {d.error.code === "vercel-git" && (
                      <span className="mt-1 block">
                        <a className="underline underline-offset-4" href="https://github.com/apps/vercel" target="_blank" rel="noopener noreferrer">
                          GitHub에서 Vercel 앱 설치하기
                        </a>
                      </span>
                    )}
                    <span className="mt-2 flex flex-wrap gap-2">
                      {(d.error.code === "github-auth" || d.error.code === "vercel-auth") && (
                        <span className="text-xs">위에서 계정을 다시 연결한 뒤 이어서 진행해 주세요.</span>
                      )}
                      {keyError && (
                        <Button size="sm" variant="outline" onClick={onKeyProblem}>
                          API 키 변경
                        </Button>
                      )}
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!canStart} onClick={() => void start()}>
                  {d.running ? "진행 중…" : d.error?.code === "neon-missing" ? "다시 확인" : d.error || d.done.length ? "다시 시도" : "만들고 올리기"}
                </Button>
                {!connected && <span className="text-sm text-muted-foreground">{!github?.connected ? "GitHub" : "Vercel"}를 먼저 연결해 주세요.</span>}
                {connected && support.status !== "ok" && !delivered && <span className="text-sm text-muted-foreground">만들 수 있는지 확인이 끝나면 눌러요.</span>}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
