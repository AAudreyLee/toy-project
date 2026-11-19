import { describe, expect, it } from "vitest";
import { documentFileName, documentSections, documentTitle, documentToMarkdown } from "./documents";

const direction = {
  oneLine: "출근 준비하는 직장인에게 미세먼지가 나쁠 때만 알려주는 서비스",
  usersSituation: "",
  problemAlternatives: "날씨 앱을 자주 까먹음",
  promisedChange: "",
  coreLoop: "",
};
const spec = {
  result: "동네를 등록하면 다음 날 아침 알림 한 통을 받는다",
  scope: ["동네 한 곳 등록", "매일 아침 7시 확인"],
  verification: [],
  notNow: "여러 동네",
};

describe("서비스 방향 문서", () => {
  it("한 줄 정의, 사용자와 상황, 문제와 지금의 대안, 약속하는 변화, 핵심 루프 다섯 항목을 순서대로 가진다", () => {
    expect(documentSections("direction", direction).map((s) => s.heading)).toEqual([
      "한 줄 정의",
      "사용자와 상황",
      "문제와 지금의 대안",
      "약속하는 변화",
      "핵심 루프",
    ]);
  });

  it("정해지지 않은 항목은 대화로 채워지는 중으로 보인다", () => {
    const s = documentSections("direction", direction);
    expect(s[1]).toMatchObject({ pending: true, text: "대화로 채워지는 중…" });
    expect(s[0]).toMatchObject({ pending: false, text: direction.oneLine });
  });
});

describe("첫 Spec 문서", () => {
  it("사용자가 얻는 결과, 범위, 확인 방법, 이번엔 하지 않는 것 네 항목을 가진다", () => {
    expect(documentSections("spec", spec).map((s) => s.heading)).toEqual([
      "사용자가 얻는 결과",
      "범위",
      "확인 방법",
      "이번엔 하지 않는 것",
    ]);
  });

  it("목록 항목이 비어 있으면 대화로 채워지는 중이고, 차 있으면 목록으로 보인다", () => {
    const s = documentSections("spec", spec);
    expect(s[1]).toMatchObject({ pending: false, items: ["동네 한 곳 등록", "매일 아침 7시 확인"] });
    expect(s[2]).toMatchObject({ pending: true, text: "대화로 채워지는 중…" });
  });
});

describe("Markdown 내려받기", () => {
  it("화면에 보이는 문서와 같은 내용을 제목과 항목 순서대로 담는다", () => {
    expect(documentToMarkdown("spec", spec)).toBe(
      [
        "# 첫 Spec",
        "",
        "## 사용자가 얻는 결과",
        "동네를 등록하면 다음 날 아침 알림 한 통을 받는다",
        "",
        "## 범위",
        "- 동네 한 곳 등록",
        "- 매일 아침 7시 확인",
        "",
        "## 확인 방법",
        "대화로 채워지는 중…",
        "",
        "## 이번엔 하지 않는 것",
        "여러 동네",
        "",
      ].join("\n"),
    );
  });

  it("서비스 방향 문서도 같은 규칙으로 변환된다", () => {
    const md = documentToMarkdown("direction", direction);
    expect(md.startsWith("# 서비스 방향\n\n## 한 줄 정의\n출근 준비하는")).toBe(true);
    expect(md).toContain("## 사용자와 상황\n대화로 채워지는 중…\n");
  });

  it("파일 이름과 화면 제목이 정해진 값이다", () => {
    expect(documentFileName("direction")).toBe("서비스방향.md");
    expect(documentFileName("spec")).toBe("첫Spec.md");
    expect(documentTitle("direction")).toBe("서비스 방향");
    expect(documentTitle("spec")).toBe("첫 Spec");
  });
});
