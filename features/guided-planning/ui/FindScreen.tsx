"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { callAgent, type Idea } from "../client";
import { MATERIAL_GROUPS } from "../materials";
import type { Connection } from "../types";

export function FindScreen({
  connection,
  initialIdea,
  onStart,
  onKeyProblem,
}: {
  connection: Connection;
  initialIdea: string;
  onStart: (idea: string, title?: string) => void;
  onKeyProblem: () => void;
}) {
  const [text, setText] = useState(initialIdea);
  const [textError, setTextError] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  function startWithText() {
    if (!text.trim()) {
      setTextError(true);
      return;
    }
    onStart(text.trim());
  }

  async function getIdeas() {
    setLoading(true);
    setError(null);
    setChosen(null);
    const avoid = ideas?.map((i) => i.title) ?? [];
    setIdeas(null);
    const res = await callAgent({ kind: "ideas", connection, materials: picked, avoid });
    setLoading(false);
    if (res.ok && res.kind === "ideas") setIdeas(res.ideas);
    else if (!res.ok) setError({ code: res.code, message: res.message });
  }

  function toggle(item: string) {
    setPicked((p) => (p.includes(item) ? p.filter((x) => x !== item) : [...p, item]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">무엇을 만들고 싶으세요?</CardTitle>
        <CardDescription>떠오르는 대로 적어도 괜찮아요. 다음 단계에서 같이 다듬어요.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          aria-label="만들고 싶은 것"
          placeholder="예) 아침마다 우리 동네 미세먼지가 나쁘면 메신저로 알려주는 서비스"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTextError(false);
          }}
          aria-invalid={textError}
        />
        {textError && <p className="text-sm text-destructive">만들고 싶은 것을 한 줄로 적어 주세요. 예: 동네 미세먼지를 아침마다 알려주는 서비스</p>}
        <div>
          <Button onClick={startWithText}>이 아이디어로 시작</Button>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Separator className="flex-1" />
          아직 떠오르는 게 없다면
          <Separator className="flex-1" />
        </div>

        <div>
          <Button variant="outline" onClick={() => setShowMaterials((v) => !v)} aria-expanded={showMaterials}>
            {showMaterials ? "재료 접기" : "쓸 수 있는 재료 보기"}
          </Button>
        </div>

        {showMaterials && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">관심 가는 재료를 두세 개 골라 보세요. 조합해서 만들 수 있는 아이디어를 추천해 드려요.</p>
            {MATERIAL_GROUPS.map((g) => (
              <section key={g.title} className="flex flex-col gap-1.5">
                <h3 className="text-[13px] font-medium text-muted-foreground">{g.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={picked.includes(item)}
                      onClick={() => toggle(item)}
                      className={cn(
                        "rounded-full border bg-background px-3 py-1 text-[13px]",
                        picked.includes(item) && "border-transparent bg-primary text-primary-foreground",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <div>
              <Button disabled={!picked.length || loading} onClick={getIdeas}>
                고른 재료로 아이디어 받기
              </Button>
            </div>

            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                아이디어를 만들고 있어요…
              </p>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error.code === "key" ? "키를 확인하지 못했어요" : "아이디어를 받지 못했어요"}</AlertTitle>
                <AlertDescription>
                  {error.message}
                  <span className="mt-2 flex flex-wrap gap-2">
                    {error.code === "key" ? (
                      <Button size="sm" variant="outline" onClick={onKeyProblem}>
                        API 키 변경
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={getIdeas}>
                        다시 받기
                      </Button>
                    )}
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {ideas && (
              <div className="flex flex-col gap-2">
                {ideas.map((idea, i) => (
                  <button
                    key={idea.title}
                    type="button"
                    aria-pressed={chosen === i}
                    onClick={() => setChosen(i)}
                    className={cn(
                      "grid gap-0.5 rounded-lg border bg-card p-3 text-left",
                      chosen === i && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <b className="font-semibold">{idea.title}</b>
                    <span className="text-[13px] text-muted-foreground">{idea.summary}</span>
                  </button>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={chosen === null} onClick={() => chosen !== null && onStart(`${ideas[chosen].title}: ${ideas[chosen].summary}`, ideas[chosen].title)}>
                    이 아이디어로 시작
                  </Button>
                  <Button variant="ghost" onClick={getIdeas}>
                    다른 아이디어 보기
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
