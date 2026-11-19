"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { documentSections, documentTitle } from "../documents";
import type { ChatMessage, DirectionDoc, SpecDoc, Stage } from "../types";

export type ChatError = { code: "key" | "failed" | "invalid"; message: string };

export function ChatScreen({
  stage,
  messages,
  doc,
  badge,
  loading,
  error,
  highlight,
  quickReplies,
  onSend,
  onRetry,
  onKeyProblem,
  onDownload,
}: {
  stage: Stage;
  messages: ChatMessage[];
  doc: DirectionDoc | SpecDoc;
  badge: { text: string; warn?: boolean };
  loading: boolean;
  error: ChatError | null;
  highlight: string[];
  quickReplies: string[];
  onSend: (text: string) => void;
  onRetry: () => void;
  onKeyProblem: () => void;
  onDownload: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, loading, error]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || loading) return;
    setDraft("");
    onSend(t);
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Card className="gap-0 py-0">
        <div className="flex max-h-[460px] min-h-48 flex-col gap-2.5 overflow-y-auto p-4" aria-label="agent와의 대화" role="log">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[88%] whitespace-pre-line rounded-xl px-3 py-2 text-sm",
                m.role === "agent" ? "self-start rounded-tl-sm bg-muted" : "self-end rounded-tr-sm bg-primary text-primary-foreground",
              )}
            >
              {m.role === "agent" && <span className="mb-0.5 block text-xs text-muted-foreground">agent</span>}
              {m.text}
            </div>
          ))}
          {loading && (
            <p role="status" className="self-start px-3 py-1 text-[13px] text-muted-foreground">
              agent가 정리하고 있어요…
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error.code === "key" ? "키를 확인하지 못했어요" : "agent가 답하지 못했어요"}</AlertTitle>
              <AlertDescription>
                {error.message}
                <span className="mt-2 flex flex-wrap gap-2">
                  {error.code === "key" ? (
                    <Button size="sm" variant="outline" onClick={onKeyProblem}>
                      API 키 변경
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={onRetry}>
                      같은 메시지 다시 보내기
                    </Button>
                  )}
                </span>
              </AlertDescription>
            </Alert>
          )}
          <div ref={endRef} />
        </div>
        {quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4">
            {quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => submit(q)}
                className="rounded-full border bg-background px-3 py-1 text-[13px] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex gap-2 border-t p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Input aria-label="메시지" placeholder="답을 적어 주세요" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" disabled={loading}>
            보내기
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CardTitle className="flex-1 text-base">{documentTitle(stage)}</CardTitle>
          <Badge variant={badge.warn ? "outline" : "secondary"}>{badge.text}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-lg border bg-background p-3.5 text-[13px]" data-testid="doc-body">
            {documentSections(stage, doc).map((s) => (
              <div key={s.key} className="mt-2.5 first:mt-0">
                <h4 className="text-[13px] font-semibold">{s.heading}</h4>
                {s.items ? (
                  <ul className="list-disc pl-[18px]">
                    {s.items.map((it) => (
                      <li key={it} className={cn(highlight.includes(s.key) && "bg-primary/15")}>
                        {it}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={cn(s.pending && "italic text-muted-foreground", !s.pending && highlight.includes(s.key) && "rounded-sm bg-primary/15")}>
                    {s.text}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={onDownload}>
              .md 내려받기
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
