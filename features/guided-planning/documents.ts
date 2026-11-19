import type { DirectionDoc, SpecDoc, Stage } from "./types";

export const PENDING_TEXT = "대화로 채워지는 중…";

export type DocSection = {
  key: string;
  heading: string;
  text?: string;
  items?: string[];
  pending: boolean;
};

export const DIRECTION_LABELS: Record<keyof DirectionDoc, string> = {
  oneLine: "한 줄 정의",
  usersSituation: "사용자와 상황",
  problemAlternatives: "문제와 지금의 대안",
  promisedChange: "약속하는 변화",
  coreLoop: "핵심 루프",
};

export const SPEC_LABELS: Record<keyof SpecDoc, string> = {
  result: "사용자가 얻는 결과",
  scope: "범위",
  verification: "확인 방법",
  notNow: "이번엔 하지 않는 것",
};

export function documentSections(stage: Stage, doc: DirectionDoc | SpecDoc): DocSection[] {
  const labels: Record<string, string> = stage === "direction" ? DIRECTION_LABELS : SPEC_LABELS;
  const values = doc as Record<string, string | string[]>;
  return Object.keys(labels).map((key) => {
    const value = values[key];
    if (Array.isArray(value)) {
      const items = value.map((v) => v.trim()).filter(Boolean);
      return items.length
        ? { key, heading: labels[key], items, pending: false }
        : { key, heading: labels[key], text: PENDING_TEXT, pending: true };
    }
    const text = (value ?? "").trim();
    return text
      ? { key, heading: labels[key], text, pending: false }
      : { key, heading: labels[key], text: PENDING_TEXT, pending: true };
  });
}

export function documentTitle(stage: Stage): string {
  return stage === "direction" ? "서비스 방향" : "첫 Spec";
}

export function documentFileName(stage: Stage): string {
  return stage === "direction" ? "서비스방향.md" : "첫Spec.md";
}

export function documentToMarkdown(stage: Stage, doc: DirectionDoc | SpecDoc): string {
  const lines = [`# ${documentTitle(stage)}`, ""];
  for (const section of documentSections(stage, doc)) {
    lines.push(`## ${section.heading}`);
    if (section.items) lines.push(...section.items.map((i) => `- ${i}`));
    else lines.push(section.text ?? "");
    lines.push("");
  }
  return lines.join("\n");
}
