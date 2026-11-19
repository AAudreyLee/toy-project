"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { callAgent } from "../client";
import { documentFileName, documentToMarkdown } from "../documents";
import {
  addUserMessage,
  applyAgentReply,
  chooseIdea,
  createProgress,
  finishDirection,
  finishSpec,
  nextAction,
  openStep,
  resolveReview,
  showEditNotice,
  stepViews,
} from "../progress";
import { clearVercelToken, loadConnection, loadProgress, loadVercelToken, saveConnection, saveProgress, saveVercelToken, type VercelConnection } from "../storage";
import type { Connection, Progress, Stage } from "../types";
import { ChatScreen, type ChatError } from "./ChatScreen";
import { DeliveryScreen } from "./DeliveryScreen";
import { FindScreen } from "./FindScreen";
import { NextBar, Roadmap } from "./Roadmap";
import { StartScreen } from "./StartScreen";

const QUICK: Record<Stage, string[]> = {
  direction: ["잘 모르겠어요, 예시를 보여주세요", "이 질문은 나중에"],
  spec: ["괜찮아요, 이대로 갈게요", "잘 모르겠어요, 예시를 보여주세요"],
};

function download(stage: Stage, p: Progress) {
  const blob = new Blob([documentToMarkdown(stage, p[stage].doc)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = documentFileName(stage);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function GuidedPlanning() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<Progress>(createProgress);
  const [conn, setConn] = useState<Connection | null>(null);
  const [changingKey, setChangingKey] = useState(false);
  const [loading, setLoading] = useState<Stage | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Stage, ChatError>>>({});
  const [highlight, setHighlight] = useState<string[]>([]);
  const [vercel, setVercel] = useState<VercelConnection | null>(null);
  const [githubFlash, setGithubFlash] = useState<"connected" | "error" | null>(null);
  const progressRef = useRef(progress);
  const inflight = useRef(false);
  const lastReflect = useRef<Partial<Record<Stage, string>>>({});

  useEffect(() => {
    // 브라우저 저장소는 서버 렌더에 없으므로 마운트 뒤에 한 번 읽는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(loadProgress(localStorage));
    setConn(loadConnection(localStorage));
    setVercel(loadVercelToken(localStorage));
    // GitHub 승인 화면에서 돌아오면 결과를 한 번 알리고 주소의 표시를 지운다.
    const flash = new URLSearchParams(window.location.search).get("github");
    if (flash === "connected" || flash === "error") {
      setGithubFlash(flash);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    progressRef.current = progress;
    if (ready) saveProgress(localStorage, progress);
  }, [progress, ready]);

  useEffect(() => {
    if (!progress.fresh.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(progress.fresh);
    const t = setTimeout(() => setHighlight([]), 2500);
    return () => clearTimeout(t);
  }, [progress.fresh]);

  async function requestReply(stage: Stage, p: Progress, reflect?: string) {
    if (!conn) return;
    lastReflect.current[stage] = reflect;
    setLoading(stage);
    setErrors((e) => ({ ...e, [stage]: undefined }));
    const res = await callAgent({
      kind: "chat",
      connection: conn,
      stage,
      projectName: p.projectName,
      idea: p.idea ?? "",
      doc: p[stage].doc,
      direction: p.direction.doc,
      messages: p[stage].messages,
      reflect,
    });
    setLoading(null);
    if (res.ok && res.kind === "chat") setProgress((cur) => applyAgentReply(cur, stage, res.reply));
    else if (!res.ok) setErrors((e) => ({ ...e, [stage]: { code: res.code, message: res.message } }));
  }

  // 단계에 처음 들어와 대화가 비어 있으면 agent가 먼저 말을 건다.
  useEffect(() => {
    if (!ready || !conn || changingKey || progress.view === "find" || progress.view === "delivery") return;
    const stage = progress.view;
    if (progress[stage].messages.length > 0 || loading || errors[stage] || inflight.current) return;
    inflight.current = true;
    void requestReply(stage, progress).finally(() => {
      inflight.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, conn, changingKey, progress, loading, errors]);

  if (!ready) return null;

  if (!conn || changingKey) {
    return (
      <StartScreen
        initial={conn}
        onCancel={conn ? () => setChangingKey(false) : undefined}
        onConnected={(c) => {
          saveConnection(localStorage, c);
          setConn(c);
          setChangingKey(false);
          setErrors({});
        }}
      />
    );
  }

  const stage = progress.view === "find" || progress.view === "delivery" ? null : progress.view;
  const reviewStep: 2 | 3 | null = stage === "direction" && progress.review[2] ? 2 : stage === "spec" && progress.review[3] ? 3 : null;

  function send(s: Stage, text: string) {
    const next = addUserMessage(progressRef.current, s, text);
    setProgress(next);
    void requestReply(s, next);
  }

  function reflect(step: 2 | 3) {
    const s: Stage = step === 2 ? "direction" : "spec";
    const note = progressRef.current.changeNote;
    const next = resolveReview(progressRef.current, step);
    setProgress(next);
    void requestReply(s, next, note);
  }

  const action =
    stage === "direction" ? (
      <Button size="sm" disabled={loading !== null} onClick={() => setProgress(finishDirection(progress))}>
        방향 확정하고 다음으로
      </Button>
    ) : stage === "spec" && !progress.finished ? (
      <Button size="sm" disabled={loading !== null} onClick={() => setProgress(finishSpec(progress))}>
        Spec 확정하기
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <span className="flex-1 truncate text-[15px] font-semibold">{progress.projectName}</span>
        <Button variant="ghost" size="sm" onClick={() => setChangingKey(true)}>
          API 키 변경
        </Button>
      </header>

      <Roadmap steps={stepViews(progress)} onOpen={(n) => setProgress(openStep(progress, n))} />

      {stage && showEditNotice(progress) && (
        <Alert className="border-primary/45 bg-primary/10">
          <AlertTitle>서비스 방향을 고치는 중이에요</AlertTitle>
          <AlertDescription>여기서 내용을 바꾸면 &apos;먼저 만들 결과&apos;는 지우지 않고 &apos;다시 확인 필요&apos;로 표시해 둘게요.</AlertDescription>
        </Alert>
      )}

      {reviewStep && (
        <Alert className="border-primary/45 bg-primary/10">
          <AlertTitle>{reviewStep === 3 ? "서비스 방향이 바뀌어서 이 Spec을 다시 확인해야 해요" : "아이디어가 바뀌어서 이 단계를 다시 확인해야 해요"}</AlertTitle>
          <AlertDescription>
            <span className="whitespace-pre-line">바뀐 부분: {progress.changeNote}</span>
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={loading !== null} onClick={() => reflect(reviewStep)}>
                바뀐 부분 반영하기
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProgress(resolveReview(progress, reviewStep))}>
                그대로 둘게요
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {stage === "spec" && progress.finished ? (
        <Card className="items-center px-5 py-7 text-center">
          <Badge className="w-fit">1~3단계 완료</Badge>
          <h2 className="text-lg font-semibold">&apos;{progress.projectName}&apos; Spec이 준비됐어요</h2>
          <p className="text-sm text-muted-foreground">서비스 방향과 첫 Spec을 내려받아 두거나, 바로 4단계로 가서 내 GitHub에 올리고 Vercel에 배포해 보세요.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => download("direction", progress)}>서비스 방향 .md</Button>
            <Button onClick={() => download("spec", progress)}>첫 Spec .md</Button>
            <Button onClick={() => setProgress(openStep(progress, 4))}>구현하고 배포하기</Button>
            <Button variant="outline" onClick={() => setProgress(openStep(progress, 2))}>
              서비스 방향 다시 고치기
            </Button>
          </div>
        </Card>
      ) : (
        <NextBar text={nextAction(progress)}>{action}</NextBar>
      )}

      {progress.view === "delivery" && (
        <DeliveryScreen
          progress={progress}
          connection={conn}
          vercel={vercel}
          githubFlash={githubFlash}
          onVercel={(v) => {
            if (v) saveVercelToken(localStorage, v);
            else clearVercelToken(localStorage);
            setVercel(v);
          }}
          onProgress={(update) => setProgress(update)}
          onBackToSpec={() => setProgress(openStep(progress, 3))}
          onKeyProblem={() => setChangingKey(true)}
        />
      )}

      {progress.view === "find" && (
        <FindScreen
          connection={conn}
          initialIdea={progress.idea ?? ""}
          onStart={(idea, title) => setProgress(chooseIdea(progress, idea, title))}
          onKeyProblem={() => setChangingKey(true)}
        />
      )}

      {stage && !(stage === "spec" && progress.finished) && (
        <ChatScreen
          stage={stage}
          messages={progress[stage].messages}
          doc={progress[stage].doc}
          badge={
            reviewStep
              ? { text: "다시 확인 필요", warn: true }
              : { text: progress[stage].done ? "확정됨" : "작성 중" }
          }
          loading={loading === stage}
          error={errors[stage] ?? null}
          highlight={highlight}
          quickReplies={QUICK[stage]}
          onSend={(t) => send(stage, t)}
          onRetry={() => {
            const p = progressRef.current;
            void requestReply(stage, p, lastReflect.current[stage]);
          }}
          onKeyProblem={() => setChangingKey(true)}
          onDownload={() => download(stage, progress)}
        />
      )}
    </div>
  );
}
