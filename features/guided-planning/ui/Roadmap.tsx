"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StepStatus, StepView } from "../progress";

const TAGS: Record<StepStatus, string> = {
  done: "완료 ✓",
  current: "지금",
  pending: "아직",
  review: "다시 확인",
  locked: "잠김",
};

export function Roadmap({ steps, onOpen }: { steps: StepView[]; onOpen: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="진행 로드맵">
        {steps.map((s) => (
          <li key={s.n} className="min-w-0">
            <button
              type="button"
              disabled={!s.clickable}
              onClick={() => onOpen(s.n)}
              aria-current={s.isCurrent ? "step" : undefined}
              title={s.status === "locked" ? "다음 업데이트에서 열려요" : s.clickable ? "눌러서 다시 고치기" : undefined}
              className={cn(
                "grid w-full min-w-0 gap-0.5 rounded-lg border bg-card p-1.5 text-left text-card-foreground sm:px-2.5 sm:py-2",
                s.clickable && "cursor-pointer hover:border-ring",
                s.isCurrent && "border-primary ring-1 ring-primary",
                s.status === "review" && "border-dashed border-primary",
                s.status === "locked" && "bg-muted opacity-60",
              )}
            >
              <span className={cn("flex justify-between gap-1 text-xs text-muted-foreground", s.isCurrent && "text-primary")}>
                <span>{s.n}단계</span>
                <span className="hidden sm:inline">{TAGS[s.status]}</span>
                <span className="sm:hidden" aria-label={TAGS[s.status]}>
                  {s.status === "done" ? "✓" : s.status === "review" ? "!" : s.status === "locked" ? "🔒" : ""}
                </span>
              </span>
              <span className="break-keep text-[11px] font-semibold leading-tight sm:text-[13px]">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {steps.some((s) => s.status === "locked") && <p className="text-xs text-muted-foreground">4 구현과 5 배포를 하려면 먼저 Spec을 확정해 주세요.</p>}
    </div>
  );
}

export function NextBar({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">지금 할 일</div>
        <div className="text-sm">{text}</div>
      </div>
      {children}
    </div>
  );
}

export { Button };
